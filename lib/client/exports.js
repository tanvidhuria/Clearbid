import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType } from "docx";

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Excel: comparison + evidence + vendors (+ award) ----------
export function exportComparisonXlsx(comp, scenario) {
  const wb = XLSX.utils.book_new();
  const vs = comp.vendors;
  const head = ["Line", "Item", "Unit", "Annual qty", ...vs.flatMap((v) => [`${v.short} ₹ landed / unit`, `${v.short} status`])];
  const rows = comp.rfx.lines.map((l) => [l.id, l.item, l.unit, l.qty, ...vs.flatMap((v) => {
    const c = comp.cells[l.id][v.id];
    return [c.landed === null ? "" : Math.round(c.landed * 100) / 100, c.status.replace("_", " ")];
  })]);
  const n = rows.length + 1;
  const totalRow = ["", "Annual landed value (quoted lines)", "", "", ...vs.flatMap((v, i) => {
    const col = XLSX.utils.encode_col(4 + i * 2);
    return [{ f: `SUMPRODUCT($D$2:$D$${n},${col}2:${col}${n})` }, `${v.coverage} of ${v.lines_total} lines`];
  })];
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows, [], totalRow]);
  ws["!cols"] = [{ wch: 6 }, { wch: 34 }, { wch: 16 }, { wch: 10 }, ...vs.flatMap(() => [{ wch: 16 }, { wch: 11 }])];
  XLSX.utils.book_append_sheet(wb, ws, "Comparison");

  const ev = [["Line", "Item", "Vendor", "As stated", "Stated unit", "Conversion", "₹ per RFx unit", "₹ landed", "Status", "Confidence", "Notes", "Source file", "Location", "Quote", "Buyer override"]];
  for (const l of comp.rfx.lines) for (const v of vs) {
    const c = comp.cells[l.id][v.id];
    ev.push([l.id, l.item, v.short, c.stated ? `${c.stated.currency} ${c.stated.price}` : "", c.stated?.unit || "", c.formula || "",
      c.norm ?? "", c.landed === null ? "" : Math.round(c.landed * 100) / 100, c.status, c.confidence || "", (c.reasons || []).join(" | "),
      c.source?.file || "", c.source?.location || "", c.source?.quote || "", c.flags.includes("override") ? "Yes" : ""]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ev), "Evidence");

  const vrows = [["Vendor", "Coverage", "Qualified", "Why", "Freight", "Discount", "Payment days", "Validity days", "Open issues"]];
  for (const v of vs) vrows.push([v.name, `${v.coverage}/${v.lines_total}`, v.qualification.status.replace("_", " "), v.qualification.reasons.join("; "),
    v.freight.note, v.discount ? `${v.discount.pct}%: ${v.discount.condition}` : "", v.terms.payment_days ?? "", v.terms.validity_days ?? "",
    v.issues.map((i) => i.text).join(" | ")]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vrows), "Vendors");

  if (scenario?.result?.allocation) {
    const r = scenario.result;
    const a = [["Line", "Item", "Qty", "Awarded to", "₹ landed / unit", "Annual value", "2nd pick", "2nd extra cost", "3rd pick", "3rd extra cost"]];
    for (const x of r.allocation) a.push([x.line, x.item, x.qty, x.winner, x.unit_landed, x.value,
      x.backups[0]?.vendor || "none", x.backups[0]?.extra_cost_per_year || "", x.backups[1]?.vendor || "none", x.backups[1]?.extra_cost_per_year || ""]);
    a.push([], ["", "Total before discount", "", "", "", r.total_before_discount], ["", "Total after discount", "", "", "", r.total_after_discount],
      ["", "Best single vendor", "", "", "", typeof r.best_single_vendor === "string" ? r.best_single_vendor : `${r.best_single_vendor.vendor}: ${r.best_single_vendor.total}`],
      ["", "Saving vs best single vendor", "", "", "", r.saving_vs_best_single || ""]);
    for (const c of r.caveats || []) a.push(["", "Caveat", "", "", "", c]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), "Award");
  }
  XLSX.writeFile(wb, `Clearbid_${comp.rfx.rfx_id}_comparison.xlsx`);
}

// ---------- Word helpers ----------
const P = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children: [new TextRun({ text, font: "Arial", size: 21, ...(opts.run || {}) })] });
const H = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: "Arial" })] });
function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const mk = (cells, head) => new TableRow({ children: cells.map((t, i) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: "E3EFE9", color: "auto" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(t ?? ""), font: "Arial", size: 18, bold: head })] })] })) });
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [mk(headers, true), ...rows.map((r) => mk(r, false))] });
}

export async function exportRfxDocx(rfx) {
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${rfx.buyer_company || "Kaveri Foods Pvt Ltd"}`, font: "Arial" })] }),
    P(`Request for Quotation ${rfx.rfx_id}: ${rfx.title}`, { run: { bold: true } }),
    P(`Issued ${rfx.issued || ""}. Responses due ${rfx.due || ""}. Contact: ${rfx.buyer_name || ""}, ${rfx.buyer_email || ""}.`),
    H("1. Line items"),
    table(["Line", "Item", "Specification", "Unit", "Annual qty"], rfx.lines.map((l) => [l.id, l.item, l.spec, l.unit, l.qty.toLocaleString("en-IN")]), [800, 2400, 3600, 1400, 1100]),
    H("2. Quality questionnaire"),
    ...(rfx.questionnaire || []).map((q) => P(`${q.id}. ${q.question}`)),
    ...(rfx.qualification_rule ? [P(rfx.qualification_rule, { run: { italics: true } })] : []),
    H("3. Commercial terms"),
    ...(rfx.terms || []).map((t, i) => P(`${i + 1}. ${t}`)),
    P("Please reply by email with your quotation in Excel format, one row per RFx line. If Excel is not possible, any format is accepted. Attach certificates and test reports as separate files."),
  ];
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }] });
  download(await Packer.toBlob(doc), `${rfx.rfx_id}_RFx.docx`);
}

export async function exportAwardDocx(comp, scenario, answerText) {
  const r = scenario.result;
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `Award note: ${comp.rfx.rfx_id}`, font: "Arial" })] }),
    P(`${comp.rfx.title}. Prepared with Clearbid on ${new Date().toLocaleDateString("en-IN")}.`),
    H("Recommendation"),
    ...String(answerText || "").split(/\n+/).filter(Boolean).map((t) => P(t.replace(/[*#`|]/g, "").trim())),
    H("Award summary"),
    table(["", "Value"], [
      ["Rule", `${r.rule.replace(/_/g, " ")}, discounts: ${String(r.discount_mode).replace(/_/g, " ")}`],
      ["Vendors considered", (r.vendors_considered || []).join(", ")],
      ["Total before discount", r.total_before_discount], ["Total after discount", r.total_after_discount],
      ["Best single vendor", typeof r.best_single_vendor === "string" ? r.best_single_vendor : `${r.best_single_vendor.vendor}: ${r.best_single_vendor.total}`],
      ["Saving vs best single vendor", r.saving_vs_best_single || "n/a"],
      ["Exchange rate used", `₹${r.fx_rate_used} per USD`],
    ], [3200, 6100]),
    H("Lines by vendor"),
    table(["Vendor", "Lines", "Annual value"], Object.entries(r.lines_by_vendor || {}).map(([k, v]) => [k, v.lines, v.value]), [3000, 1500, 4800]),
    H("Allocation with backups"),
    table(["Line", "Item", "Awarded to", "₹ / unit", "Annual value", "2nd pick (extra cost)", "3rd pick (extra cost)"],
      (r.allocation || []).map((x) => [x.line, x.item, x.winner, x.unit_landed, x.value,
        x.backups[0] ? `${x.backups[0].vendor} (+${x.backups[0].extra_cost_per_year})` : "none",
        x.backups[1] ? `${x.backups[1].vendor} (+${x.backups[1].extra_cost_per_year})` : "none"]), [650, 2100, 1100, 1000, 1300, 1600, 1600]),
    H("Risks and conditions"),
    ...((r.caveats || []).length ? r.caveats.map((c) => P(`• ${c}`)) : [P("None recorded.")]),
    ...(r.single_bidder_lines?.length ? [P(`Single qualified bidder: ${r.single_bidder_lines.join("; ")}`)] : []),
    H("Evidence"),
    P("Every price in this note traces to a vendor document. The full line-by-line evidence (source file, location, quote, conversion and buyer overrides) is in the Clearbid Excel export, Evidence sheet."),
  ];
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, children }] });
  download(await Packer.toBlob(doc), `${comp.rfx.rfx_id}_award_note.docx`);
}
