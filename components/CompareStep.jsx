"use client";
import { useMemo, useState } from "react";
import { unitPrice, lakh, inr } from "../lib/core.js";
import { api } from "../lib/client/api.js";
import { exportComparisonXlsx } from "../lib/client/exports.js";

const STATUS_LABEL = { ok: "As quoted", converted: "Converted", confirmed: "Confirmed by buyer", review: "Needs review", reference: "Refers to last year", not_quoted: "Not quoted" };
const STATUS_TONE = { ok: "ok", converted: "ok", confirmed: "ok", review: "warn", reference: "warn", not_quoted: "grey" };

export default function CompareStep({ st, patch, patchVendor, comp, resolveReference, go }) {
  const [tab, setTab] = useState("grid");
  const [sel, setSel] = useState(null);
  if (!comp) return (
    <>
      <div className="page-head"><div><h1>Compare</h1><p>Nothing to compare yet.</p></div></div>
      <p className="notice">Receive and read at least one vendor response first. <button className="btn ghost" onClick={() => go("responses")}>Go to responses</button></p>
    </>
  );
  const mailV = st.mailFor ? comp.vendors.find((v) => v.id === st.mailFor) : null;
  const mail = mailV ? { vendor: mailV } : null;
  const setMail = (m) => patch({ mailFor: m ? m.vendor.id : null });
  const setA = (p) => patch((s) => ({ ...s, assumptions: { ...s.assumptions, ...p } }));
  const refVendors = comp.vendors.filter((v) => v.reference_count > 0 || st.vendors[v.id]?.reference);
  const review = comp.vendors.reduce((a, v) => a + v.review_count, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare</h1>
          <p>Every price converted to the RFx unit and to rupees, landed at the plants, pre-GST. Click any cell to see where it came from. Amber means a person should look. Ask the assistant anything about it.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => exportComparisonXlsx(comp)}>Download Excel</button>
        </div>
      </div>

      <div className="toolbar panel panel-pad" style={{ padding: "12px 16px" }}>
        <label className="field">USD rate (₹ per $)
          <input type="number" step="0.05" value={st.assumptions.fx_usd_inr} style={{ width: 110 }} onChange={(e) => setA({ fx_usd_inr: Number(e.target.value) || 0 })} />
        </label>
        <label className="field">Award date (for certificate validity)
          <input type="date" value={st.assumptions.award_date} onChange={(e) => setA({ award_date: e.target.value })} />
        </label>
        <div className="small muted" style={{ maxWidth: 420 }}>
          Assumptions apply everywhere: grid, exports and analyst answers. {review > 0 && <b style={{ color: "var(--amber)" }}>{review} {review === 1 ? "cell needs" : "cells need"} review.</b>}
        </div>
      </div>

      {refVendors.map((v) => {
        const sv = st.vendors[v.id];
        return (
          <div key={v.id} className="notice" style={{ marginBottom: 14 }}>
            {sv.reference ? (
              <span><b>{v.short}:</b> last year's rates read from {sv.reference.file}. {v.reference_count > 0 ? `${v.reference_count} line(s) were not on it and stay unquoted.` : ""} Each filled line is marked for confirmation.</span>
            ) : (<>
              <b>{v.short} wrote "same as last year" for {v.reference_count} lines</b>, without prices. Those lines are left out of every total until you provide last year's rates or the vendor sends them.
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" disabled={sv.refBusy} onClick={() => resolveReference(v.id, { name: "PO-2025-118_Northstar.pdf", url: "/data/reference/PO-2025-118_Northstar.pdf" })}>Use last year's PO from Kaveri's records</button>
                <label className="btn">Upload last year's PO<input type="file" hidden onChange={(e) => e.target.files[0] && resolveReference(v.id, { name: e.target.files[0].name, blob: e.target.files[0] })} /></label>
                <button className="btn ghost" onClick={() => setMail({ vendor: v })}>Ask {v.short} for the prices</button>
                {sv.refBusy && <span className="thinking">Reading last year's PO</span>}
                {sv.refError && <span className="err small">{sv.refError}</span>}
              </div>
            </>)}
          </div>
        );
      })}

      <div className="tabs" role="tablist">
        {[["grid", "Price grid"], ["vendors", "Vendors and documents"], ["evidence", "Evidence"]].map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>

      {tab === "grid" && <Grid comp={comp} sel={sel} setSel={setSel} />}
      {tab === "vendors" && <Vendors comp={comp} setMail={setMail} st={st} />}
      {tab === "evidence" && <Evidence comp={comp} />}

      {sel && <Drawer key={sel.line + sel.vendor} comp={comp} sel={sel} onClose={() => setSel(null)} st={st} patchVendor={patchVendor} />}
      {mail && <MailModal vendor={mail.vendor} comp={comp} st={st} patch={patch} onClose={() => setMail(null)} />}
    </>
  );
}

function Grid({ comp, sel, setSel }) {
  const groups = [...new Set(comp.rfx.lines.map((l) => l.group))];
  const best = useMemo(() => {
    const b = {};
    for (const l of comp.rfx.lines) {
      let min = null;
      for (const v of comp.vendors) {
        const c = comp.cells[l.id][v.id];
        if (v.qualification.status !== "qualified" || c.norm === null || c.flags.includes("substitute")) continue;
        if (!min || c.landed < min.landed) min = { v: v.id, landed: c.landed };
      }
      b[l.id] = min?.v;
    }
    return b;
  }, [comp]);
  return (
    <>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th className="sticky-l">RFx line</th>
            {comp.vendors.map((v) => (
              <th key={v.id} className="vhead">
                <div className="name">{v.short}
                  <span className={`chip ${v.qualification.status === "qualified" ? "ok" : v.qualification.status === "pending" ? "grey" : "bad"}`} title={v.qualification.reasons.join("; ")}>
                    {v.qualification.status === "qualified" ? "Qualified" : v.qualification.status === "pending" ? "Pending" : "Not qualified"}</span></div>
                <div className="cov" title={`${v.coverage} of ${v.lines_total} lines priced`}><span style={{ width: `${(v.coverage / v.lines_total) * 100}%` }} /></div>
                <div className="meta">{v.coverage} of {v.lines_total} lines priced{v.review_count ? `, ${v.review_count} to review` : ""}</div>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g} className="group-row"><td className="sticky-l" colSpan={1}>{g}</td><td colSpan={comp.vendors.length} /></tr>,
              ...comp.rfx.lines.filter((l) => l.group === g).map((l) => (
                <tr key={l.id}>
                  <td className="line-cell sticky-l"><span className="id">{l.id}</span>{l.item}<div className="u">per {l.unit}, {l.qty.toLocaleString("en-IN")} a year</div></td>
                  {comp.vendors.map((v) => {
                    const c = comp.cells[l.id][v.id];
                    const on = sel && sel.line === l.id && sel.vendor === v.id;
                    return (
                      <td key={v.id}>
                        <button className={`cell st-${c.status}${best[l.id] === v.id ? " best" : ""}`} aria-pressed={on} onClick={() => setSel({ line: l.id, vendor: v.id })}
                          title={`${STATUS_LABEL[c.status]}${c.reasons.length ? ": " + c.reasons[0] : ""}`}>
                          {c.landed !== null ? <span className="v">{unitPrice(c.landed)}</span> : <span className="v">{c.status === "not_quoted" ? "Not quoted" : c.status === "reference" ? "Last year?" : "Unclear"}</span>}
                          <span className="s">{c.status === "review" ? (c.flags.includes("outlier") ? "Check unit" : c.flags.includes("reads_disagree") ? "Reads differ" : c.flags.includes("from_reference") ? "Confirm" : c.flags.includes("ambiguous") ? "Shared price" : "Review")
                            : c.flags.includes("substitute") ? "Substitute" : c.flags.includes("usd") ? "From USD" : c.flags.includes("converted") ? "Converted" : c.status === "confirmed" ? "Confirmed" : "\u00a0"}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
            <tr className="total-row">
              <td className="sticky-l" style={{ textAlign: "left" }}>Annual landed value of priced lines</td>
              {comp.vendors.map((v) => <td key={v.id}>{lakh(v.landed_total)}<div className="small muted" style={{ fontWeight: 400 }}>{v.coverage}/{v.lines_total} lines{v.freight_known ? "" : ", freight not incl."}</div></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span><i style={{ background: "#bcd8ca" }} />As quoted</span>
        <span><i style={{ background: "#7fb39b" }} />Converted to the RFx unit</span>
        <span><i style={{ background: "#d9a441" }} />Needs review</span>
        <span><i style={{ background: "var(--green)" }} />Confirmed by buyer</span>
        <span><i style={{ background: "var(--green)", borderRadius: "50%" }} />Lowest among qualified vendors</span>
      </div>
    </>
  );
}

function Drawer({ comp, sel, onClose, st, patchVendor }) {
  const line = comp.rfx.lines.find((l) => l.id === sel.line);
  const v = comp.vendors.find((x) => x.id === sel.vendor);
  const c = comp.cells[sel.line][sel.vendor];
  const [val, setVal] = useState(c.norm ?? "");
  const [note, setNote] = useState("");
  const setOv = (o) => patchVendor(v.id, (sv) => ({ overrides: { ...(sv.overrides || {}), [line.id]: o } }));
  const clearOv = () => patchVendor(v.id, (sv) => { const o = { ...(sv.overrides || {}) }; delete o[line.id]; return { overrides: o }; });
  const file = st.vendors[v.id]?.files?.find((f) => f.name === c.source?.file);
  return (
    <aside className="drawer" aria-label="Cell evidence">
      <header>
        <div><div className="small muted">{line.id} {line.item}</div><h2>{v.name}</h2></div>
        <button className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
      </header>
      <div className="body">
        <div>
          <div className="big">{c.landed !== null ? unitPrice(c.landed) : STATUS_LABEL[c.status]}</div>
          <div className="small muted">{c.landed !== null ? `landed per ${line.unit}, pre-GST` : ""}</div>
          <div style={{ marginTop: 6 }}><span className={`chip ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span> {c.confidence && <span className="chip">Confidence: {c.confidence}</span>} {c.verified && <span className="chip ok">Value found in source</span>}</div>
        </div>
        {c.reasons.length > 0 && <div className={c.status === "review" || c.status === "reference" ? "notice" : "notice ok"}><ul className="issues" style={{ paddingLeft: 16 }}>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        <dl className="kv">
          {c.stated && <><dt>As stated</dt><dd className="num">{c.stated.currency} {c.stated.price} {c.stated.unit ? `(${c.stated.unit})` : ""}</dd></>}
          {c.description && <><dt>Vendor item</dt><dd>{c.description}</dd></>}
          {c.formula && <><dt>Conversion</dt><dd className="num">{c.formula}</dd></>}
          {c.norm !== null && <><dt>Per RFx unit</dt><dd className="num">{unitPrice(c.norm)}</dd></>}
          <dt>Freight</dt><dd>{v.freight.note}</dd>
          {c.norm !== null && <><dt>Annual value</dt><dd className="num">{inr(c.landed * line.qty)} for {line.qty.toLocaleString("en-IN")}</dd></>}
        </dl>
        {c.source && (c.source.file || c.source.quote) && (
          <div>
            <h3 style={{ marginBottom: 6 }}>Source</h3>
            <div className="small muted" style={{ marginBottom: 6 }}>{file?.url ? <a href={file.url} target="_blank" rel="noreferrer">{c.source.file}</a> : c.source.file}{c.source.location ? `, ${c.source.location}` : ""}</div>
            {c.source.quote && <blockquote className="src">“{c.source.quote}”</blockquote>}
            {file?.url && /\.(jpe?g|png)$/i.test(file.name) && <img src={file.url} alt={`Photo of ${v.short}'s rate card`} style={{ width: "100%", marginTop: 8, borderRadius: 4, border: "1px solid var(--line)" }} />}
          </div>
        )}
        <div className="panel panel-pad" style={{ background: "var(--paper)" }}>
          <h3 style={{ marginBottom: 8 }}>Your decision</h3>
          <div className="row">
            {c.norm !== null && c.status !== "confirmed" && <button className="btn primary" onClick={() => setOv({ confirmed: true })}>Confirm this value</button>}
            {(c.flags.includes("override") || c.status === "confirmed") && <button className="btn" onClick={clearOv}>Undo my change</button>}
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <label className="field">₹ per {line.unit}<input type="number" step="0.01" value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 120 }} /></label>
            <label className="field" style={{ flex: 1 }}>Reason<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. vendor confirmed by phone" /></label>
            <button className="btn" disabled={val === ""} onClick={() => setOv({ price_rfx: Number(val), note })}>Set price</button>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Changes are recorded in the Evidence sheet of the Excel export.</p>
        </div>
      </div>
    </aside>
  );
}

function Vendors({ comp, setMail, st }) {
  return (
    <div className="vendor-cards">
      {comp.vendors.map((v) => (
        <section key={v.id} className="panel vcard">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{v.name}</h2>
            <span className={`chip ${v.qualification.status === "qualified" ? "ok" : "bad"}`}>{v.qualification.status === "qualified" ? "Qualified" : "Not qualified"}</span>
          </div>
          <ul className="checks">
            {v.qualification.checks.map((c) => <li key={c.name}><span className={`mark ${c.pass ? "pass" : "fail"}`}>{c.pass ? "✓" : "✕"}</span><span><b>{c.name}.</b> {c.detail}</span></li>)}
          </ul>
          <dl className="kv">
            <dt>Coverage</dt><dd>{v.coverage} of {v.lines_total} lines priced</dd>
            <dt>Freight</dt><dd>{v.freight.note}</dd>
            <dt>Discount</dt><dd>{v.discount ? `${v.discount.pct}%: ${v.discount.condition}` : "None"}</dd>
            <dt>Payment</dt><dd>{v.terms.payment_days ? `${v.terms.payment_days} days` : "Not stated"}</dd>
            <dt>Validity</dt><dd>{v.terms.validity_days ? `${v.terms.validity_days} days` : "Not stated"}</dd>
          </dl>
          {v.suspicious.length > 0 && <div className="notice bad small"><b>Hidden instruction found and ignored.</b>{v.suspicious.map((s, i) => <div key={i} style={{ marginTop: 4 }}>{s.file}: “{s.text}”</div>)}</div>}
          <details><summary className="small" style={{ cursor: "pointer" }}>Documents ({v.documents.length})</summary>
            <table className="plain" style={{ marginTop: 6 }}><tbody>{v.documents.map((d, i) => (
              <tr key={i}><td className="small">{d.file}</td><td className="small">{d.relates_to_rfx === false ? <span className="chip bad">Not for this RFx</span> : <span className="chip ok">{String(d.type).replace(/_/g, " ")}</span>}<div className="muted">{d.reason}</div></td></tr>
            ))}</tbody></table>
          </details>
          <details><summary className="small" style={{ cursor: "pointer" }}>Questionnaire answers ({v.questionnaire.length})</summary>
            <table className="plain" style={{ marginTop: 6 }}><tbody>{v.questionnaire.map((q) => (
              <tr key={q.qid}><td className="small muted">{q.qid}</td><td className="small">{q.answer}</td></tr>
            ))}</tbody></table>
          </details>
          {v.extra_items.length > 0 && <p className="small muted">Also listed, not in the RFx: {v.extra_items.join(", ")}</p>}
          <div>
            <h3 style={{ marginBottom: 4 }}>Open issues ({v.issues.length})</h3>
            {v.issues.length ? <ul className="issues">{v.issues.map((i, k) => <li key={k} className={i.severity === "high" ? "sev-high" : ""}>{i.text}</li>)}</ul> : <p className="small muted">None.</p>}
          </div>
          <div className="row">
            {v.issues.some((i) => i.ask) && <button className="btn" onClick={() => setMail({ vendor: v })}>{st.emails?.[v.id] ? "Review clarification email" : "Draft clarification email"}</button>}
            {st.emails?.[v.id]?.sent && <span className="chip ok">Clarification sent</span>}
          </div>
        </section>
      ))}
    </div>
  );
}

function Evidence({ comp }) {
  const [q, setQ] = useState("");
  const rows = [];
  for (const l of comp.rfx.lines) for (const v of comp.vendors) {
    const c = comp.cells[l.id][v.id];
    const r = { l, v, c };
    const txt = `${l.id} ${l.item} ${v.short} ${c.status} ${(c.reasons || []).join(" ")}`.toLowerCase();
    if (!q || txt.includes(q.toLowerCase())) rows.push(r);
  }
  return (
    <div className="panel panel-pad">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>Every data point, where it came from and how it was converted. {rows.length} rows.</p>
        <input className="btn" placeholder="Filter, e.g. review or Balaji" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll-x" style={{ maxHeight: "60vh" }}>
        <table className="plain">
          <thead><tr><th>Line</th><th>Vendor</th><th>As stated</th><th>Conversion</th><th className="r">₹ landed</th><th>Status</th><th>Source</th></tr></thead>
          <tbody>{rows.map(({ l, v, c }) => (
            <tr key={l.id + v.id}>
              <td className="small">{l.id} {l.item}</td><td className="small">{v.short}</td>
              <td className="small num">{c.stated ? `${c.stated.currency} ${c.stated.price} ${c.stated.unit || ""}` : "—"}</td>
              <td className="small">{c.formula || "—"}</td>
              <td className="r small">{c.landed !== null ? unitPrice(c.landed) : "—"}</td>
              <td className="small"><span className={`chip ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>{c.reasons[0] && <div className="muted">{c.reasons[0]}</div>}</td>
              <td className="small">{c.source?.file}{c.source?.location ? `, ${c.source.location}` : ""}{c.source?.quote && <div className="muted">“{c.source.quote}”</div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function MailModal({ vendor, comp, st, patch, onClose }) {
  const existing = st.emails?.[vendor.id];
  const [draft, setDraft] = useState(existing || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const asks = vendor.issues.filter((i) => i.ask).map((i) => i.ask);
  const sv = st.vendors[vendor.id];
  const make = async () => {
    setBusy(true); setErr("");
    try { const r = await api("/api/clarify", { vendor: vendor.name, contact: sv?.contact, rfx_id: comp.rfx.rfx_id, asks }); setDraft({ subject: r.subject, body: r.body }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const send = () => {
    const at = new Date().toISOString();
    patch((s) => ({ ...s, emails: { ...s.emails, [vendor.id]: { ...draft, sent: true, at } },
      outbox: [...s.outbox, { to: `${vendor.name} <${sv?.email_address || ""}>`, subject: draft.subject, at, kind: "Clarification" }] }));
    onClose();
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Clarification email">
      <div className="modal">
        <header><h2>Clarification for {vendor.short}</h2><button className="btn ghost" onClick={onClose}>Close</button></header>
        <div className="body">
          <div><h3 style={{ marginBottom: 4 }}>What we need to ask</h3><ul className="issues">{asks.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          {!draft ? <button className="btn primary" onClick={make} disabled={busy || !asks.length}>{busy ? "Drafting…" : "Draft the email"}</button> : (<>
            <label className="field">Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
            <label className="field">Email<textarea rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
          </>)}
          {err && <p className="err small">{err}</p>}
        </div>
        {draft && <footer><span className="small muted">Sending is simulated. Nothing leaves the app until you approve.</span>
          {draft.sent ? <span className="chip ok">Sent</span> : <button className="btn primary" onClick={send}>Approve and send</button>}</footer>}
      </div>
    </div>
  );
}
