"use client";
import { useState } from "react";

export default function Gate({ onOk }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (d.ok) { localStorage.setItem("clearbid-access", code); onOk(); } else setErr(d.error || "That code doesn't match.");
  };
  return (
    <div className="gate">
      <form onSubmit={submit}>
        <h1>Clearbid</h1>
        <p className="muted">Draft an RFx, read every vendor reply in whatever format it arrives, and ask plain-language questions until you can defend the award.</p>
        <label className="field">Access code
          <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="From the submission email" />
        </label>
        {err && <p className="err small">{err}</p>}
        <button className="btn primary" disabled={busy || !code}>{busy ? "Checking…" : "Open Clearbid"}</button>
        <p className="small muted">This demo uses live AI calls, so each visitor gets {25} questions.</p>
      </form>
    </div>
  );
}
