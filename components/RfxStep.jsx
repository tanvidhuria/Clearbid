"use client";
import { useRef, useState, useEffect } from "react";
import { api, fileToB64 } from "../lib/client/api.js";
import { exportRfxDocx } from "../lib/client/exports.js";

const IDEAS = [
  "Add an exchange rate clause for imported items",
  "Add 600 pairs of welding gloves, EN 12477, per pair",
  "Make the freight basis per plant explicit in the terms",
];

export default function RfxStep({ st, patch, published, askAllowed, countQuestion }) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const log = useRef(null);
  const rfx = st.rfx;
  const isPublished = rfx.rfx_id === published.rfx_id;
  useEffect(() => { log.current?.scrollTo(0, 1e6); }, [st.copilot.length, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    if (!askAllowed) { setErr("This demo's AI question limit is used up in this browser."); return; }
    countQuestion(); setErr(""); setBusy(true); setInput("");
    const names = files.map((f) => f.name);
    const msgs = [...st.copilot, { role: "user", content: q + (names.length ? `\n(Attached: ${names.join(", ")})` : "") }];
    patch({ copilot: msgs });
    try {
      const attachments = await Promise.all(files.map((f) => fileToB64(f, f.name)));
      setFiles([]);
      const r = await api("/api/copilot", { messages: msgs, rfx, attachments });
      patch((s) => ({ ...s, copilot: [...msgs, { role: "assistant", content: r.reply || "Updated the RFx." }],
        rfx: r.update ? { ...s.rfx, ...Object.fromEntries(Object.entries(r.update).filter(([, v]) => v !== undefined)) } : s.rfx }));
    } catch (e) { setErr(e.message); patch({ copilot: msgs }); }
    setBusy(false);
  };

  const groups = [...new Set(rfx.lines.map((l) => l.group || "Items"))];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Draft the RFx</h1>
          <p>Talk the RFx into shape with the co-pilot. It asks for units, pack sizes and freight basis upfront, which prevents most of the mess that comes back.</p>
        </div>
        <div className="row no-print">
          <button className="btn" onClick={() => exportRfxDocx(rfx)} disabled={!rfx.lines.length}>Download Word</button>
          <button className="btn" onClick={() => window.print()} disabled={!rfx.lines.length}>Print or save as PDF</button>
        </div>
      </div>
      <div className="split">
        <section className="panel chat no-print" aria-label="RFx co-pilot">
          <div className="chat-log" ref={log}>
            {!st.copilot.length && (
              <div className="msg ai"><div className="bubble">
                <p>I'm the RFx co-pilot. {isPublished ? "The RFx the five vendors received is loaded on the right. Ask me to change it, or start a blank one and describe what you need." : "Describe what you need to buy, or attach last year's PO or an indent sheet and I'll draft from it."}</p>
              </div></div>
            )}
            {st.copilot.map((m, i) => (
              <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                {m.role === "user" ? m.content : <div className="bubble">{m.content}</div>}
              </div>
            ))}
            {busy && <div className="thinking">Updating the RFx</div>}
          </div>
          {!st.copilot.length && <div className="suggest">{IDEAS.map((t) => <button key={t} onClick={() => send(t)}>{t}</button>)}</div>}
          {err && <p className="err small" style={{ padding: "0 14px" }}>{err}</p>}
          {files.length > 0 && <p className="small muted" style={{ padding: "0 14px" }}>Attached: {files.map((f) => f.name).join(", ")}</p>}
          <div className="chat-input">
            <label className="btn" title="Attach a file">Attach
              <input type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.txt" onChange={(e) => setFiles([...e.target.files])} />
            </label>
            <textarea rows={2} value={input} placeholder="e.g. Add 200 face shields for the Hosur plant" onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn primary" onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
          </div>
        </section>

        <article className="panel rfx-doc">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="title">{rfx.title || "Untitled RFx"}</div>
              <div className="muted small">RFx {rfx.rfx_id} for {rfx.buyer_company}, issued {rfx.issued}, responses due {rfx.due}</div>
            </div>
            <div className="row no-print">
              {isPublished
                ? <button className="btn ghost" onClick={() => patch({ rfx: { ...published, rfx_id: "KF-DRAFT-" + Date.now().toString(36).toUpperCase(), title: "New RFx", lines: [], questionnaire: [], terms: [] }, copilot: [] })}>Start a blank RFx</button>
                : <button className="btn ghost" onClick={() => patch({ rfx: published, copilot: [] })}>Load the RFx vendors received</button>}
            </div>
          </div>
          {!isPublished && <p className="notice small" style={{ marginTop: 12 }}>This is a new draft. The five demo vendor responses were written against RFx {published.rfx_id}; load it before reading responses.</p>}
          <h2>Line items</h2>
          {!rfx.lines.length ? <p className="muted">No lines yet. Tell the co-pilot what you need.</p> : (
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
