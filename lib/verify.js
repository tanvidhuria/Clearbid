// Checks that every meaningful number in an AI answer appears in the tool results it was given.
function numsFromText(text) {
  const out = [];
  const re = /(₹|rs\.?|usd|\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|lakh|crore|cr\b)?/gi;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    const raw = m[2];
    const v = Number(raw.replace(/,/g, ""));
    if (Number.isNaN(v)) continue;
    const money = !!m[1] || !!m[3];
    out.push({ raw: m[0].trim(), v, money, lineId: /[lLqQ]$/.test(before) });
  }
  return out;
}

export function allowedNumbers(texts) {
  const set = [];
  for (const t of texts) for (const n of numsFromText(typeof t === "string" ? t : JSON.stringify(t))) {
    set.push(n.v);
    if (n.v >= 1e4) { set.push(n.v / 1e5, n.v / 1e7); }
  }
  return set;
}

export function unverifiedNumbers(answer, allowed) {
  const bad = [];
  for (const n of numsFromText(answer)) {
    if (n.lineId) continue;
    if (n.v >= 2020 && n.v <= 2035 && !n.money) continue; // years
    if (!n.money && n.v < 100) continue; // small counts
    const ok = allowed.some((a) => Math.abs(a - n.v) <= Math.max(0.051, Math.abs(a) * 0.006));
    if (!ok) bad.push(n.raw);
  }
  return [...new Set(bad)];
}
