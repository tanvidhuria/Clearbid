// Clearbid core logic. Plain code, no AI: every number the buyer sees is computed here.
// Shared by the browser (grid, exports) and the server (analyst tools).

export const PLANT_KEYS = ["pune", "sonipat", "hosur"];

// ---------- formatting ----------
const INR_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const INR_FMT2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function inr(x, decimals = false) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return "₹" + (decimals ? INR_FMT2.format(x) : INR_FMT.format(Math.round(x)));
}
export function unitPrice(x) {
  if (x === null || x === undefined) return "—";
  const r = Math.round(x * 100) / 100;
  return Number.isInteger(r) ? inr(r) : inr(r, true);
}
export function lakh(x) {
  if (x === null || x === undefined) return "—";
  return "₹" + (x / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " lakh";
}
export function money(x) {
  return `${inr(x)} (${lakh(x)})`;
}
export function pct(x, d = 1) {
  return (x * 100).toFixed(d) + "%";
}

// ---------- units ----------
// RFx unit text -> { basis, count } e.g. "box of 100 pcs" -> { basis: "piece", count: 100 }
export function parseRfxUnit(u) {
  const s = (u || "").toLowerCase();
  const m = s.match(/(\d[\d,]*)/);
  const count = m ? Number(m[1].replace(/,/g, "")) : 1;
  let basis = "piece";
  if (/pair/.test(s)) basis = "pair";
  else if (/\bset\b/.test(s)) basis = "set";
  return { basis, count };
}
const BASIS_WORD = { piece: ["piece", "pieces"], pair: ["pair", "pairs"], set: ["set", "sets"] };
function basisLabel(basis, n) {
  const w = BASIS_WORD[basis] || [basis, basis + "s"];
  return n === 1 ? w[0] : `${n.toLocaleString("en-IN")} ${w[1]}`;
}

// ---------- freight ----------
export function freightUplift(freight, plants) {
  if (!freight) return { uplift: null, note: "Freight terms not stated" };
  const t = freight.type;
  if (t === "included_all") return { uplift: 0, note: "Freight included to all plants" };
  if (t === "extra_percent" && typeof freight.pct === "number")
    return { uplift: freight.pct / 100, note: `Freight extra at ${freight.pct}% on all deliveries` };
  if (t === "included_some" && typeof freight.pct === "number") {
    const incl = (freight.plants_included || []).map((p) => p.toLowerCase());
    let share = 0;
    for (const p of plants) {
      const key = PLANT_KEYS.find((k) => p.name.toLowerCase().includes(k)) || p.name.toLowerCase();
      if (!incl.some((i) => i.includes(key) || key.includes(i))) share += p.share;
    }
    return { uplift: (freight.pct / 100) * share,
      note: `Freight included to ${freight.plants_included.join(", ")}; ${freight.pct}% extra on other plants (${pct(share, 0)} of volume)` };
  }
  return { uplift: null, note: freight.text ? `Freight not quantified: "${freight.text}"` : "Freight not quantified" };
}

// ---------- numbers inside source text (for "does this value exist in the file?") ----------
export function numbersIn(text) {
  const out = new Set();
  if (!text) return out;
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text))) {
    const v = Number(m[0].replace(/,/g, ""));
    if (!Number.isNaN(v)) out.add(Math.round(v * 100) / 100);
  }
  return out;
}

// ---------- the comparison ----------
// state = { rfx, vendors: [ {id,name,short,received,batch,quote,docs,secondRead,reference,sourceNumbers,overrides,excluded} ], assumptions }
export function buildComparison(state) {
  const { rfx, assumptions } = state;
  const fx = Number(assumptions.fx_usd_inr) || 0;
  const plants = rfx.plants || [];
  const vendors = state.vendors.filter((v) => v.quote);
  const cells = {};
  const vinfo = {};

  for (const v of vendors) {
    const f = freightUplift(v.quote.terms?.freight, plants);
    vinfo[v.id] = { freight: f, qualification: qualify(v, assumptions), issues: [] };
  }

  for (const line of rfx.lines) {
    cells[line.id] = {};
    const ru = parseRfxUnit(line.unit);
    for (const v of vendors) cells[line.id][v.id] = computeCell(line, ru, v, vinfo[v.id], fx, assumptions);
    // outlier check against the other vendors' comparable prices
    const comparable = Object.entries(cells[line.id]).filter(([, c]) => c.norm !== null && c.norm !== undefined);
    for (const [vid, c] of comparable) {
      const others = comparable.filter(([id]) => id !== vid).map(([, x]) => x.norm).sort((a, b) => a - b);
      if (others.length < 2) continue;
      const med = others[Math.floor(others.length / 2)];
      const ratio = c.norm / med;
      if (ratio < 0.6 || ratio > 1.4) {
        const times = ratio < 1 ? (1 / ratio) : ratio;
        c.flags.push("outlier");
        c.reasons.push(`Possible unit error: ${times.toFixed(1)}× ${ratio < 1 ? "below" : "above"} the other vendors' median (${unitPrice(med)})`);
        if (c.status !== "confirmed") c.status = "review";
      }
    }
  }

  const vendorSummaries = vendors.map((v) => summarizeVendor(v, rfx, cells, vinfo[v.id], assumptions));
  return { rfx, assumptions, vendors: vendorSummaries, cells };
}

function computeCell(line, ru, v, info, fx, assumptions) {
  const base = { line: line.id, vendor: v.id, flags: [], reasons: [], status: "ok", norm: null, landed: null };
  const q = (v.quote.lines || []).find((l) => l.rfx_line_id === line.id);
  const ov = v.overrides?.[line.id];
  let src = q;
  if (!q || q.status === "not_quoted") {
    return { ...base, status: "not_quoted", reasons: [q?.reason || "Not quoted in this response"],
      source: q ? { file: q.source_file, location: q.source_location, quote: q.source_quote } : null };
  }
  if (q.status === "reference") {
    const r = (v.reference?.lines || []).find((l) => l.rfx_line_id === line.id);
    if (!r || r.price === null || r.price === undefined) {
      return { ...base, status: "reference", flags: ["reference"],
        reasons: [v.reference ? "Refers to last year's rates, but this item is not on last year's PO" : "Refers to last year's rates, not provided"],
        source: { file: q.source_file, location: q.source_location, quote: q.source_quote } };
    }
    src = { ...q, ...r, status: "quoted", from_reference: true };
  }
  if (src.price === null || src.price === undefined) {
    return { ...base, status: "review", reasons: ["No price found for this line"],
      source: { file: src.source_file, location: src.source_location, quote: src.source_quote } };
  }

  const cell = { ...base, stated: { price: src.price, currency: src.currency || "INR", unit: src.stated_unit },
    description: src.vendor_description, confidence: src.confidence || "medium",
    source: { file: src.source_file, location: src.source_location, quote: src.source_quote } };
  const steps = [];
  let price = src.price;
  if ((src.currency || "INR") === "USD") {
    price = src.price * fx;
    cell.flags.push("usd");
    steps.push(`USD ${src.price.toFixed(2)} × ₹${fx.toFixed(2)} = ${unitPrice(price)}`);
  } else if (src.currency && src.currency !== "INR") {
    cell.status = "review"; cell.reasons.push(`Currency ${src.currency} has no exchange rate set`);
    return cell;
  }

  const per = src.units_per_stated;
  if (!src.unit_basis || src.unit_basis === "unknown" || !per) {
    cell.status = "review"; cell.flags.push("unit_unclear");
    cell.reasons.push(`Unit unclear: "${src.stated_unit || "not stated"}". Pack size not given, so it can't be converted to ${line.unit}`);
    return cell;
  }
  if (src.unit_basis !== ru.basis) {
    cell.status = "review"; cell.flags.push("unit_unclear");
    cell.reasons.push(`Quoted per ${src.unit_basis}, but the RFx asks per ${ru.basis}`);
    return cell;
  }
  let norm = (price / per) * ru.count;
  if (per !== ru.count) {
    cell.flags.push("converted");
    const su = (src.stated_unit || "").replace(/^per\s+/i, "");
    const statedAs = su ? `"${su}" (${basisLabel(src.unit_basis, per)})` : basisLabel(src.unit_basis, per);
    const math = per === 1 ? `× ${ru.count}` : ru.count === 1 ? `÷ ${per}` : `÷ ${per} × ${ru.count}`;
    steps.push(`${unitPrice(price)} per ${statedAs} ${math} = ${unitPrice(norm)} per ${line.unit}`);
  }
  cell.formula = steps.length ? steps.join("; ") : "As quoted";

  if (src.is_substitute) { cell.flags.push("substitute"); cell.reasons.push("Substitute offered: " + (src.condition || "not the specified item")); }
  if (src.condition && !src.is_substitute) { cell.flags.push("conditional"); cell.reasons.push("Condition: " + src.condition); }
  if (src.status === "ambiguous") { cell.status = "review"; cell.flags.push("ambiguous"); cell.reasons.push(src.reason || "One vendor price may cover more than one RFx line"); }
  if (src.from_reference) { cell.flags.push("from_reference"); cell.reasons.push("From last year's PO (vendor wrote \"same as last year\"). Confirm before award"); cell.status = "review"; }
  if (src.confidence === "low") { cell.status = "review"; cell.reasons.push(src.confidence_reason || "Low confidence reading"); }
  else if (src.confidence_reason) cell.reasons.push(src.confidence_reason);

  // does the stated number exist in the source text? (text files only)
  const nums = v.sourceNumbers?.[src.source_file];
  if (nums && !src.from_reference) {
    const has = nums.has ? nums.has(Math.round(src.price * 100) / 100) : nums.includes(Math.round(src.price * 100) / 100);
    if (has) cell.verified = true;
    else { cell.verified = false; cell.status = "review"; cell.flags.push("not_in_source"); cell.reasons.push(`The value ${src.price} was not found in ${src.source_file}`); }
  }
  // two independent reads (photos)
  const sr = v.secondRead?.find((l) => l.rfx_line_id === line.id);
  if (sr && sr.price !== null && sr.price !== undefined && Math.abs(sr.price - src.price) > 0.001) {
    cell.status = "review"; cell.flags.push("reads_disagree");
    cell.reasons.push(`Two independent reads disagree: ${src.price} or ${sr.price}`);
  } else if (sr) cell.flags.push("double_read");

  if (ov?.price_rfx !== undefined && ov?.price_rfx !== null) {
    norm = Number(ov.price_rfx); cell.status = "confirmed"; cell.flags.push("override");
    cell.reasons.unshift(`Buyer set ${unitPrice(norm)} per ${line.unit}${ov.note ? `: ${ov.note}` : ""}`);
  } else if (ov?.confirmed) {
    cell.status = "confirmed"; cell.reasons.unshift("Confirmed by buyer");
  } else if (cell.flags.includes("converted") && cell.status === "ok") cell.status = "converted";

  cell.norm = norm;
  const up = info.freight.uplift;
  cell.landed = up === null ? norm : norm * (1 + up);
  if (up === null) cell.flags.push("freight_unknown");
  return cell;
}

export function qualify(v, assumptions) {
  const q = v.docs?.qualification;
  if (!q) return { status: "pending", checks: [], reasons: ["Documents not read yet"] };
  const awardDate = assumptions.award_date || new Date().toISOString().slice(0, 10);
  const checks = [];
  const isiOk = !!(q.isi_helmet_licence && q.isi_shoes_licence);
  checks.push({ name: "ISI licences (helmets and shoes)", pass: isiOk,
    detail: isiOk ? `Helmets ${q.isi_helmet_licence}; shoes ${q.isi_shoes_licence}`
      : `Missing evidence for ${[!q.isi_helmet_licence && "helmets", !q.isi_shoes_licence && "shoes"].filter(Boolean).join(" and ")}` });
  const iso = q.iso_valid_until;
  const isoOk = !!iso && iso >= awardDate;
  checks.push({ name: "Valid ISO 9001", pass: isoOk,
    detail: !iso ? "No ISO 9001 certificate found" : isoOk ? `Valid until ${iso}` : `Expired on ${iso}` });
  const lt = q.lead_time_max_days;
  const ltOk = typeof lt === "number" && lt <= 21;
  checks.push({ name: "Lead time 21 days or less", pass: ltOk,
    detail: typeof lt !== "number" ? "Lead time not stated" : `${q.lead_time_text || lt + " days"}` });
  const pass = checks.every((c) => c.pass);
  return { status: pass ? "qualified" : "not_qualified", checks, reasons: checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) };
}

function summarizeVendor(v, rfx, cells, info, assumptions) {
  let coverage = 0, review = 0, reference = 0, total = 0, totalKnown = true;
  for (const line of rfx.lines) {
    const c = cells[line.id][v.id];
    if (c.norm !== null) { coverage++; total += c.landed * line.qty; }
    if (c.status === "review") review++;
    if (c.status === "reference") reference++;
  }
  if (info.freight.uplift === null) totalKnown = false;
  const t = v.quote.terms || {};
  const issues = vendorIssues(v, rfx, cells, info, t);
  return {
    id: v.id, name: v.name, short: v.short, received: v.received, batch: v.batch,
    coverage, lines_total: rfx.lines.length, review_count: review, reference_count: reference,
    landed_total: total, freight: info.freight, freight_known: totalKnown,
    qualification: info.qualification, terms: t, discount: t.discount && typeof t.discount.pct === "number" ? t.discount : null,
    discount_enabled: !!assumptions.discounts_enabled?.[v.id],
    documents: v.docs?.documents || [], questionnaire: v.docs?.questionnaire || [],
    extra_items: v.quote.extra_items || [], suspicious: [...(v.quote.suspicious || []), ...(v.docs?.suspicious || [])],
    issues,
  };
}

function vendorIssues(v, rfx, cells, info, t) {
  const out = [];
  const add = (severity, text, ask) => out.push({ severity, text, ask });
  const d = v.docs || {};
  for (const doc of d.documents || []) {
    if (doc.relates_to_rfx === false)
      add("high", `Wrong document: ${doc.file} (${doc.reason})`, `Confirm that ${doc.file} was attached by mistake; we have not used it`);
  }
  for (const m of d.promised_but_missing || [])
    add("high", `Promised but not received: ${m}`, `Please send ${m}`);
  const sus = [...(v.quote.suspicious || []), ...(d.suspicious || [])];
  for (const s of sus) add("high", `Suspicious content in ${s.file}: "${s.text}"`, null);
  const q = d.qualification || {};
  if (q.en388_report_model && q.quoted_cut_glove_model &&
      q.en388_report_model.replace(/\W/g, "").toLowerCase() !== q.quoted_cut_glove_model.replace(/\W/g, "").toLowerCase())
    add("medium", `EN 388 report is for ${q.en388_report_model}, but ${q.quoted_cut_glove_model} was quoted`,
      `Please send the EN 388 test report for the quoted model ${q.quoted_cut_glove_model}`);
  for (const c of info.qualification.checks || []) if (!c.pass) add("high", `Fails qualification: ${c.name} (${c.detail})`,
    c.name.startsWith("ISI") ? "Please share BIS licence numbers and copies for the helmets and shoes offered"
      : c.name.startsWith("Valid ISO") ? "Please share a currently valid ISO 9001 certificate"
        : "Please confirm whether lead time can be 21 days or less for all items");
  if (info.freight.uplift === null) add("medium", info.freight.note, "Please state freight charges for delivery to Pune, Sonipat and Hosur");
  if (t.discount && typeof t.discount.pct === "number") add("medium", `Discount ${t.discount.pct}% with condition: ${t.discount.condition}`,
    `Please confirm whether the ${t.discount.pct}% discount applies to the annual contract value or to each individual purchase order`);
  if (typeof t.payment_days === "number" && t.payment_days < 60) add("low", `Payment ${t.payment_days} days (Kaveri standard is 60)`, "Please confirm if 60-day payment terms are possible");
  if (typeof t.validity_days === "number" && t.validity_days < 90) add("low", `Validity ${t.validity_days} days (RFx asked for 90)`, "Please extend validity to 90 days");
  const missing = [], unclear = [], refs = [], disagree = [], subs = [];
  for (const line of rfx.lines) {
    const c = cells[line.id][v.id];
    if (c.status === "not_quoted") missing.push(line);
    if (c.status === "reference") refs.push(line);
    if (c.flags.includes("unit_unclear")) unclear.push(line);
    if (c.flags.includes("reads_disagree")) disagree.push(line);
    if (c.flags.includes("substitute")) subs.push(line);
  }
  const names = (ls) => ls.map((l) => `${l.id} ${l.item}`).join("; ");
  if (missing.length) add("medium", `${missing.length} line(s) not quoted: ${names(missing)}`, `Please quote for: ${names(missing)}, or confirm you cannot supply them`);
  if (refs.length) add("medium", `${refs.length} line(s) refer to last year's rates without a price`, `Please state the actual price for: ${names(refs)}`);
  if (unclear.length) add("medium", `Unit or pack size unclear on ${unclear.length} line(s): ${names(unclear)}`, `Please confirm the unit and pack size for: ${names(unclear)}`);
  if (disagree.length) add("medium", `Hard-to-read values on ${disagree.length} line(s): ${names(disagree)}`, `Please confirm the rate for: ${names(disagree)}`);
  if (subs.length) add("medium", `Substitute offered on ${names(subs)}`, `Please confirm whether the specified item can be supplied for: ${names(subs)}`);
  return out;
}
