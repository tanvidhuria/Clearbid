import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

function ext(name) { return (name.split(".").pop() || "").toLowerCase(); }

function xlsxToText(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out = [];
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws["!ref"]) continue;
    out.push(`--- Sheet "${sn}" ---`);
    const r = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = r.s.r; R <= r.e.r; R++) {
      const cells = [];
      for (let C = r.s.c; C <= r.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const c = ws[addr];
        if (!c || c.v === undefined || c.v === null || c.v === "") continue;
        cells.push(`${addr}=${c.w ?? c.v}`);
      }
      if (cells.length) out.push(`Row ${R + 1}: ${cells.join(" | ")}`);
    }
  }
  return out.join("\n");
}

// Turn an uploaded file into Claude content blocks plus plain text (for checks)
export async function prepareFile(f) {
  const buf = Buffer.from(f.base64, "base64");
  const e = ext(f.name);
  if (IMAGE_TYPES[e]) {
    return { name: f.name, kind: "image", text: null,
      blocks: [{ type: "text", text: `FILE: ${f.name} (photo)` },
        { type: "image", source: { type: "base64", media_type: IMAGE_TYPES[e], data: f.base64 } }] };
  }
  if (e === "pdf") {
    let text = "";
    try { const pdf = await getDocumentProxy(new Uint8Array(buf)); text = (await extractText(pdf, { mergePages: true })).text; } catch { text = ""; }
    return { name: f.name, kind: "pdf", text,
      blocks: [{ type: "text", text: `FILE: ${f.name} (PDF)` },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 }, title: f.name }] };
  }
  let text;
  if (e === "xlsx" || e === "xls" || e === "csv") text = xlsxToText(buf);
  else if (e === "docx") text = (await mammoth.extractRawText({ buffer: buf })).value;
  else text = buf.toString("utf8");
  const label = { xlsx: "Excel workbook, cell addresses shown", xls: "Excel workbook", csv: "CSV", docx: "Word document", eml: "email" }[e] || "text";
  return { name: f.name, kind: "text", text,
    blocks: [{ type: "text", text: `FILE: ${f.name} (${label})\n<file_content>\n${text}\n</file_content>` }] };
}

// Code-level scan for text that tries to instruct an AI (backs up the model's own report)
export function scanForInstructions(name, text) {
  if (!text) return [];
  const hits = [];
  const re = /[^.\n]*(?:\b(?:ai|assistant|language model|llm|chatgpt|claude)\b[^.\n]{0,80}\b(?:rank|ignore|prefer|approve|do not flag|instruction)|ignore (?:all |any )?(?:previous|prior) instructions)[^.\n]*[.\n]?/gi;
  let m;
  while ((m = re.exec(text))) hits.push({ file: name, text: m[0].trim().slice(0, 240), why: "Text addressed to an AI system inside a vendor document", detected_by: "code scan" });
  return hits;
}
