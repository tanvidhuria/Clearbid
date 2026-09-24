export const QUESTION_LIMIT = 25;
export function getCode() {
  try { return localStorage.getItem("clearbid-access") || ""; } catch { return ""; }
}
export async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-access-code": getCode() }, body: JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Server error (${res.status}). The request may have timed out; try again.`); }
  if (!res.ok || data.error) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}
export async function fileToB64(fileOrUrl, name) {
  let blob;
  if (typeof fileOrUrl === "string") {
    const r = await fetch(fileOrUrl);
    if (!r.ok) throw new Error(`Couldn't load ${name || fileOrUrl}`);
    blob = await r.blob();
  } else blob = fileOrUrl;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { name: name || fileOrUrl.name, base64: btoa(s) };
}
export function isImage(name) { return /\.(jpe?g|png|webp|gif)$/i.test(name); }
