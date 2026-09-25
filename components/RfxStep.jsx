"use client";
import { exportRfxDocx } from "../lib/client/exports.js";

export default function RfxStep({ st, patch, published }) {
  const rfx = st.rfx;
  const isPublished = rfx.rfx_id === published.rfx_id;
  const groups = [...new Set(rfx.lines.map((l) => l.group || "Items"))];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Draft the RFx</h1>
          <p>Shape the RFx by talking to the assistant on the right. It asks for units, pack sizes and freight basis upfront, which prevents most of the mess that comes back.</p>
        </div>
        <div className="row no-print">
          <button className="btn" onClick={() => exportRfxDocx(rfx)} disabled={!rfx.lines.length}>Download Word</button>
          <button className="btn" onClick={() => window.print()} disabled={!rfx.lines.length}>Print or save as PDF</button>
        </div>
      </div>
      <div>
        <article className="panel rfx-doc">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="title">{rfx.title || "Untitled RFx"}</div>
              <div className="muted small">RFx {rfx.rfx_id} for {rfx.buyer_company}, issued {rfx.issued}, responses due {rfx.due}</div>
            </div>
            <div className="row no-print">
              {isPublished
                ? <button className="btn ghost" onClick={() => patch({ rfx: { ...published, rfx_id: "KF-DRAFT-" + Date.now().toString(36).toUpperCase(), title: "New RFx", lines: [], questionnaire: [], terms: [] }, chat: st.chat })}>Start a blank RFx</button>
                : <button className="btn ghost" onClick={() => patch({ rfx: published })}>Load the RFx vendors received</button>}
            </div>
          </div>
          {!isPublished && <p className="notice small" style={{ marginTop: 12 }}>This is a new draft. The five demo vendor responses were written against RFx {published.rfx_id}; load it before reading responses.</p>}
          <h2>Line items</h2>
          {!rfx.lines.length ? <p className="muted">No lines yet. Tell the assistant what you need.</p> : (
            <div className="scroll-x"><table className="plain">
              <thead><tr><th>Line</th><th>Item</th><th>Specification</th><th>Unit</th><th className="r">Annual qty</th></tr></thead>
              <tbody>
                {groups.map((g) => [
                  <tr key={g}><td colSpan={5} className="muted small" style={{ background: "var(--paper)", fontWeight: 600 }}>{g}</td></tr>,
                  ...rfx.lines.filter((l) => (l.group || "Items") === g).map((l) => (
                    <tr key={l.id}><td className="muted num">{l.id}</td><td>{l.item}</td><td className="small">{l.spec}</td><td className="small">{l.unit}</td><td className="r">{Number(l.qty).toLocaleString("en-IN")}</td></tr>
                  )),
                ])}
              </tbody>
            </table></div>
          )}
          <h2>Quality questionnaire</h2>
          {(rfx.questionnaire || []).length ? <ol className="small" style={{ paddingLeft: 18 }}>{rfx.questionnaire.map((q) => <li key={q.id}>{q.question}</li>)}</ol> : <p className="muted">None yet.</p>}
          {rfx.qualification_rule && <p className="small"><b>Qualification rule.</b> {rfx.qualification_rule}</p>}
          <h2>Commercial terms</h2>
          {(rfx.terms || []).length ? <ol className="small" style={{ paddingLeft: 18 }}>{rfx.terms.map((t, i) => <li key={i}>{t}</li>)}</ol> : <p className="muted">None yet.</p>}
        </article>
      </div>
    </>
  );
}
