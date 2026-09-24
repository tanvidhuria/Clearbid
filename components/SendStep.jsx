"use client";
import { useState } from "react";

export default function SendStep({ st, patch, go }) {
  const vendors = Object.values(st.vendors).filter((v) => !v.uploaded);
  const [open, setOpen] = useState(vendors[0]?.id);
  const body = (v) => `Dear ${v.contact || "Sir/Madam"},

Kaveri Foods invites your quotation for RFx ${st.rfx.rfx_id}: ${st.rfx.title}.

Please quote every line per the unit stated, excluding GST, and state freight to our Pune, Sonipat and Hosur plants. If you cannot supply a line, write "Not quoted". Please reply with your quotation in Excel format, one row per RFx line; if that isn't possible, any format is accepted. Attach your certificates and test reports as separate files.

Responses are due by ${st.rfx.due}. The RFx document is attached.

Regards,
${st.rfx.buyer_name}
${st.rfx.buyer_title || "Category Buyer"}, ${st.rfx.buyer_company}`;

  const send = () => {
    const at = new Date().toISOString();
    patch((s) => ({ ...s, sent: true, sentAt: at, step: "responses",
      outbox: [...s.outbox, ...vendors.map((v) => ({ to: `${v.name} <${v.email_address}>`, subject: `RFx ${s.rfx.rfx_id}: request for quotation`, at, kind: "RFx" }))] }));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Send to vendors</h1>
          <p>Each vendor gets the RFx as a Word document with a short email. Sending is simulated in this demo: the emails are written and logged, but nothing leaves the app.</p>
        </div>
        <div className="row">
          {st.sent ? <span className="chip ok">Sent to {vendors.length} vendors</span>
            : <button className="btn primary" onClick={send}>Send RFx to {vendors.length} vendors</button>}
          {st.sent && <button className="btn" onClick={() => go("responses")}>Go to responses</button>}
        </div>
      </div>
      <div className="split">
        <div className="panel">
          {vendors.map((v) => (
            <button key={v.id} onClick={() => setOpen(v.id)} className="btn ghost" style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", borderBottom: "1px solid var(--line)", borderRadius: 0, color: open === v.id ? "var(--green)" : "var(--ink)", fontWeight: open === v.id ? 600 : 400 }}>
              {v.name}<div className="small muted" style={{ fontWeight: 400 }}>{v.email_address}, {v.city}</div>
            </button>
          ))}
        </div>
        <div className="panel panel-pad">
          {vendors.filter((v) => v.id === open).map((v) => (
            <div key={v.id}>
              <dl className="kv">
                <dt>To</dt><dd>{v.name} &lt;{v.email_address}&gt;</dd>
                <dt>Subject</dt><dd>RFx {st.rfx.rfx_id}: request for quotation</dd>
                <dt>Attachment</dt><dd>{st.rfx.rfx_id}_RFx.docx</dd>
              </dl>
              <div className="email-preview" style={{ maxHeight: "none", color: "var(--ink)", background: "#fff", border: "1px solid var(--line)", marginTop: 14, padding: 16 }}>{body(v)}</div>
            </div>
          ))}
          {st.outbox.length > 0 && (<>
            <h3 style={{ marginTop: 20 }}>Outbox</h3>
            <table className="plain"><thead><tr><th>To</th><th>Subject</th><th>When</th></tr></thead>
              <tbody>{st.outbox.map((o, i) => <tr key={i}><td className="small">{o.to}</td><td className="small">{o.subject}</td><td className="small muted">{new Date(o.at).toLocaleString("en-IN")}</td></tr>)}</tbody></table>
          </>)}
        </div>
      </div>
    </>
  );
}
