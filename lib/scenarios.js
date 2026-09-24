import { buildComparison, inr, lakh, money, unitPrice, pct } from "./core.js";

function withAssumptions(state, patch) {
  return patch ? { ...state, assumptions: { ...state.assumptions, ...patch } } : state;
}

function eligibleVendors(comp, { vendor_ids, qualified_only = true } = {}) {
  return comp.vendors.filter((v) =>
    (!vendor_ids || !vendor_ids.length || vendor_ids.includes(v.id) || vendor_ids.includes(v.short)) &&
    (!qualified_only || v.qualification.status === "qualified"));
}

function candidate(comp, line, v, include_substitutes) {
  const c = comp.cells[line.id][v.id];
  if (!c || c.norm === null || c.norm === undefined) return null;
  if (c.flags.includes("substitute") && !include_substitutes) return null;
  return c;
}

// ---------- award scenario ----------
export function runScenario(state, opts = {}) {
  const {
    rule = "cheapest_per_line", vendor_ids, qualified_only = true, include_substitutes = false,
    discount_mode = "apply_after", fx_rate, line_ids,
  } = opts;
  const comp = buildComparison(withAssumptions(state, fx_rate ? { fx_usd_inr: fx_rate } : null));
  const lines = comp.rfx.lines.filter((l) => !line_ids || !line_ids.length || line_ids.includes(l.id));
  const vendors = eligibleVendors(comp, { vendor_ids, qualified_only });
  const discountOf = (v) => (v.discount && typeof v.discount.pct === "number" ? v.discount : null);
  const threshold = (v) => discountOf(v)?.threshold_inr || 0;

  function allocate(disc) {
    const alloc = [];
    for (const line of lines) {
      const cands = vendors.map((v) => {
        const c = candidate(comp, line, v, include_substitutes);
        if (!c) return null;
        const eff = disc[v.id] ? c.landed * (1 - discountOf(v).pct / 100) : c.landed;
        return { v, c, eff };
      }).filter(Boolean).sort((a, b) => a.eff - b.eff);
      alloc.push({ line, cands });
    }
    return alloc;
  }

  let result;
  if (rule === "single_vendor") {
    const rows = vendors.map((v) => {
      let total = 0, covered = 0;
      const missing = [];
      for (const line of lines) {
        const c = candidate(comp, line, v, include_substitutes);
        if (c) { total += c.landed * line.qty; covered++; } else missing.push(line.id);
      }
      const d = discountOf(v);
      const discApplies = d && discount_mode !== "ignore" && total > threshold(v);
      const discount = discApplies ? total * d.pct / 100 : 0;
      return { vendor: v.short, vendor_id: v.id, lines_covered: covered, lines_missing: missing,
        total_before_discount: money(total), discount: discApplies ? `${d.pct}% = ${inr(discount)}` : "none",
        total_after_discount: money(total - discount), _total: total - discount, _full: missing.length === 0,
        freight_known: v.freight_known };
    }).sort((a, b) => a._total - b._total);
    result = { rule, vendors: rows.map(({ _total, _full, ...r }) => ({ ...r, covers_all_lines: _full })) };
  } else {
    let disc = {};
    if (discount_mode === "price_in") for (const v of vendors) if (discountOf(v)) disc[v.id] = true;
    let alloc;
    for (let i = 0; i < 5; i++) {
      alloc = allocate(disc);
      let changed = false;
      for (const v of vendors) {
        if (!disc[v.id]) continue;
        const val = alloc.reduce((s, a) => s + (a.cands[0]?.v.id === v.id ? a.cands[0].c.landed * a.line.qty : 0), 0);
        if (val <= threshold(v)) { disc[v.id] = false; changed = true; }
      }
      if (!changed) break;
    }
    const byVendor = {};
    const rows = [];
    const uncovered = [];
    let totalBefore = 0;
    for (const { line, cands } of alloc) {
      if (!cands.length) { uncovered.push(`${line.id} ${line.item}`); continue; }
      const w = cands[0];
      const value = w.c.landed * line.qty;
      totalBefore += value;
      byVendor[w.v.short] = byVendor[w.v.short] || { lines: 0, value: 0, id: w.v.id };
      byVendor[w.v.short].lines++; byVendor[w.v.short].value += value;
      rows.push({
        line: line.id, item: line.item, qty: line.qty, unit: line.unit, winner: w.v.short,
        unit_landed: unitPrice(w.c.landed), value: inr(value), _value: value,
        winner_status: w.c.status,
        backups: cands.slice(1, 3).map((b) => ({ vendor: b.v.short, unit_landed: unitPrice(b.c.landed),
          extra_cost_per_year: inr((b.c.landed - w.c.landed) * line.qty) })),
        only_bidder: cands.length === 1,
      });
    }
    const discounts = [];
    let discTotal = 0;
    for (const [short, b] of Object.entries(byVendor)) {
      const v = vendors.find((x) => x.id === b.id);
      const d = discountOf(v);
      if (!d || discount_mode === "ignore") continue;
      const met = b.value > threshold(v);
      const amt = met ? b.value * d.pct / 100 : 0;
      discTotal += amt;
      discounts.push({ vendor: short, pct: d.pct, awarded_value: money(b.value), threshold: inr(threshold(v)),
        threshold_met: met, discount: inr(amt), condition: d.condition });
    }
    // best single vendor under the same filters
    const singles = vendors.map((v) => {
      let t = 0, ok = true;
      for (const line of lines) { const c = candidate(comp, line, v, include_substitutes); if (!c) { ok = false; break; } t += c.landed * line.qty; }
      if (!ok) return null;
      const d = discountOf(v);
      const after = d && discount_mode !== "ignore" && t > threshold(v) ? t * (1 - d.pct / 100) : t;
      return { vendor: v.short, total: after, before: t };
    }).filter(Boolean).sort((a, b) => a.total - b.total);
    const best = singles[0] || null;
    const totalAfter = totalBefore - discTotal;
    const caveats = [];
    const reviewWins = rows.filter((r) => r.winner_status === "review");
    if (reviewWins.length) caveats.push(`${reviewWins.length} winning line(s) still need buyer review: ${reviewWins.map((r) => r.line).join(", ")}`);
    for (const v of vendors) if (!v.freight_known && byVendor[v.short]) caveats.push(`${v.short}: freight not quantified, so its landed prices exclude freight`);
    for (const d of discounts) if (d.condition) caveats.push(`${d.vendor} discount condition as written: "${d.condition}". Confirm it applies to this award`);
    if (uncovered.length) caveats.push(`No eligible vendor for: ${uncovered.join("; ")}`);

    result = {
      rule, discount_mode, fx_rate_used: comp.assumptions.fx_usd_inr,
      vendors_considered: vendors.map((v) => v.short),
      lines_by_vendor: Object.fromEntries(Object.entries(byVendor).map(([k, b]) => [k, { lines: b.lines, value: money(b.value) }])),
      total_before_discount: money(totalBefore), discounts, total_after_discount: money(totalAfter),
      best_single_vendor: best ? { vendor: best.vendor, total: money(best.total) } : "No single eligible vendor covers every line",
      saving_vs_best_single: best ? money(best.total - totalAfter) : null,
      single_bidder_lines: rows.filter((r) => r.only_bidder).map((r) => `${r.line} ${r.item} (${r.winner})`),
      uncovered_lines: uncovered, caveats,
      allocation: rows.map(({ _value, ...r }) => r),
    };
  }
  return result;
}

// ---------- overview ----------
export function overview(state) {
  const comp = buildComparison(state);
  return {
    event: `${comp.rfx.rfx_id}: ${comp.rfx.title}`, lines: comp.rfx.lines.length,
    assumptions: { fx_usd_inr: comp.assumptions.fx_usd_inr, award_date: comp.assumptions.award_date,
      comparison_basis: "pre-GST, landed (freight added where the vendor quantified it), per RFx unit" },
    qualification_rule: comp.rfx.qualification_rule,
    vendors: comp.vendors.map((v) => ({
      id: v.id, vendor: v.short, full_name: v.name, received: v.received,
      coverage: `${v.coverage} of ${v.lines_total} lines`, lines_needing_review: v.review_count,
      lines_referring_to_last_year_unresolved: v.reference_count,
      landed_total_quoted_lines: money(v.landed_total), freight: v.freight.note,
      qualification: v.qualification.status, qualification_reasons: v.qualification.reasons,
      discount: v.discount ? `${v.discount.pct}% (${v.discount.condition})` : "none",
      payment_days: v.terms.payment_days ?? "not stated", validity_days: v.terms.validity_days ?? "not stated",
      open_issues: v.issues.length,
    })),
  };
}

export function getLines(state, { line_ids, group, vendor_ids } = {}) {
  const comp = buildComparison(state);
  const lines = comp.rfx.lines.filter((l) => (!line_ids || !line_ids.length || line_ids.includes(l.id)) &&
    (!group || l.group.toLowerCase().includes(group.toLowerCase())));
  const vs = comp.vendors.filter((v) => !vendor_ids || !vendor_ids.length || vendor_ids.includes(v.id) || vendor_ids.includes(v.short));
  return lines.slice(0, 30).map((l) => ({
    line: l.id, item: l.item, unit: l.unit, qty: l.qty,
    quotes: vs.map((v) => {
      const c = comp.cells[l.id][v.id];
      return { vendor: v.short, status: c.status,
        price_per_rfx_unit: c.norm === null ? null : unitPrice(c.norm), landed: c.landed === null ? null : unitPrice(c.landed),
        as_stated: c.stated ? `${c.stated.currency} ${c.stated.price} ${c.stated.unit || ""}`.trim() : null,
        conversion: c.formula || null, notes: c.reasons, source: c.source };
    }),
  }));
}

export function vendorDetails(state, { vendor_id }) {
  const comp = buildComparison(state);
  const v = comp.vendors.find((x) => x.id === vendor_id || x.short.toLowerCase() === String(vendor_id).toLowerCase());
  if (!v) return { error: `No vendor ${vendor_id}` };
  return { vendor: v.name, terms: v.terms, freight: v.freight.note, qualification: v.qualification,
    documents: v.documents.map((d) => ({ file: d.file, type: d.type, relates_to_this_rfx: d.relates_to_rfx, note: d.reason, facts: d.facts })),
    questionnaire: v.questionnaire, extra_items_not_in_rfx: v.extra_items, suspicious_content: v.suspicious, open_issues: v.issues.map((i) => i.text) };
}

export function openIssues(state) {
  const comp = buildComparison(state);
  return comp.vendors.map((v) => ({ vendor: v.short, qualification: v.qualification.status, issues: v.issues.map((i) => `[${i.severity}] ${i.text}`) }));
}

// ---------- exchange rate sensitivity with a ±3% band and 8% reopen limit ----------
export function fxSensitivity(state, { fx_rate, band_pct = 3, reopen_pct = 8 }) {
  const base = Number(state.assumptions.fx_usd_inr);
  const comp = buildComparison(state);
  const move = fx_rate / base - 1;
  const out = [];
  for (const line of comp.rfx.lines) for (const v of comp.vendors) {
    const c = comp.cells[line.id][v.id];
    if (!c.flags.includes("usd")) continue;
    const baseNorm = c.norm;
    const pureUsd = baseNorm * (fx_rate / base);
    const beyond = Math.max(0, Math.abs(move) - band_pct / 100) * Math.sign(move);
    const withClause = baseNorm * (1 + beyond);
    out.push({ vendor: v.short, line: line.id, item: line.item,
      at_base_rate: unitPrice(baseNorm), at_new_rate_pure_usd: unitPrice(pureUsd), with_clause: unitPrice(withClause),
      annual_impact_pure_usd: inr((pureUsd - baseNorm) * line.qty), annual_impact_with_clause: inr((withClause - baseNorm) * line.qty) });
  }
  return { base_rate: base, new_rate: fx_rate, move: pct(move, 2), crosses_band: Math.abs(move) > band_pct / 100,
    crosses_reopen_limit: Math.abs(move) > reopen_pct / 100,
    rule: `Within ±${band_pct}% prices stay fixed; beyond it, only the extra movement is passed on; beyond ${reopen_pct}% either side may reopen the price`,
    lines: out };
}
