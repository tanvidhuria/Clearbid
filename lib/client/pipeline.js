import { api, fileToB64, isImage } from "./api.js";

// Keep the AI's own reports; add code-scan hits only for files the AI didn't flag
function mergeSuspicious(ai = [], scan = []) {
  const files = new Set(ai.map((s) => s.file));
  return [...ai, ...scan.filter((s) => !files.has(s.file))];
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((s) => { const k = (s.text || "").slice(0, 60).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Read one vendor response end to end. onStep reports progress text.
export async function readVendor(rfx, vendor, onStep) {
  const load = (f) => (f.blob ? fileToB64(f.blob, f.name) : fileToB64(f.url, f.name));
  const email = vendor.files.filter((f) => f.role === "email");
  const quoteFiles = vendor.files.filter((f) => f.role === "quote");
  const attach = vendor.files.filter((f) => f.role === "attachment");
  const quoteSet = await Promise.all([...email, ...(quoteFiles.length ? quoteFiles : attach)].map(load));
  const allSet = await Promise.all([...email, ...quoteFiles, ...attach].map(load));

  onStep("Reading prices and terms");
  const q = await api("/api/extract", { rfx, mode: "quote", vendorName: vendor.name, files: quoteSet });
  onStep("Checking documents and questionnaire");
  const d = await api("/api/extract", { rfx, mode: "docs", vendorName: vendor.name, files: allSet });

  let secondRead = null;
  const photos = quoteSet.filter((f) => isImage(f.name));
  if (photos.length) {
    onStep("Second independent read of the photo");
    const s = await api("/api/extract", { rfx, mode: "second_read", vendorName: vendor.name, files: photos });
    secondRead = s.data.lines;
  }
  const quote = { ...q.data, suspicious: dedupe(mergeSuspicious(q.data.suspicious || [], q.scan || [])) };
  const docs = { ...d.data, suspicious: dedupe(mergeSuspicious(d.data.suspicious || [], d.scan || []).filter(
    (s) => !(quote.suspicious || []).some((x) => (x.text || "").slice(0, 40) === (s.text || "").slice(0, 40)))) };
  return { quote, docs, secondRead, sourceNumbers: { ...d.sourceNumbers, ...q.sourceNumbers }, truncated: q.truncated,
    readAt: new Date().toISOString() };
}

export async function readReference(rfx, vendor, file) {
  const lineIds = (vendor.quote?.lines || []).filter((l) => l.status === "reference").map((l) => l.rfx_line_id);
  const f = file.blob ? await fileToB64(file.blob, file.name) : await fileToB64(file.url, file.name);
  const r = await api("/api/extract", { rfx, mode: "reference", vendorName: vendor.name, files: [f], line_ids: lineIds });
  return { ...r.data, file: file.name, lines: (r.data.lines || []).map((l) => ({ ...l, source_file: file.name })) };
}
