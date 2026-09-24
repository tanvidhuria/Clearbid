"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { buildComparison } from "../lib/core.js";
import { readVendor, readReference } from "../lib/client/pipeline.js";
import { getCode, QUESTION_LIMIT } from "../lib/client/api.js";
import Gate from "./Gate.jsx";
import RfxStep from "./RfxStep.jsx";
import SendStep from "./SendStep.jsx";
import ResponsesStep from "./ResponsesStep.jsx";
import CompareStep from "./CompareStep.jsx";
import AnalystStep from "./AnalystStep.jsx";

const KEY = "clearbid-v1";
const today = () => new Date().toISOString().slice(0, 10);

function vendorsFromManifest(m) {
  const out = {};
  for (const r of m.responses) {
    out[r.vendor_id] = {
      id: r.vendor_id, name: r.vendor, short: r.short, contact: r.contact, email_address: r.email_address, city: r.city,
      received: r.received, batch: r.batch, status: "waiting",
      files: [
        { name: r.email.split("/").pop(), url: "/data/" + r.email, role: "email" },
        ...r.quote_files.map((p) => ({ name: p.split("/").pop(), url: "/data/" + p, role: "quote" })),
        ...r.attachments.map((p) => ({ name: p.split("/").pop(), url: "/data/" + p, role: "attachment" })),
      ],
    };
  }
  return out;
}

function initialState(published, manifest) {
  return {
    step: "rfx", rfx: published, copilot: [], sent: false, outbox: [],
    vendors: vendorsFromManifest(manifest),
    assumptions: { fx_usd_inr: 88.5, award_date: today(), discounts_enabled: {} },
    analyst: [], emails: {},
  };
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [st, setSt] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [used, setUsed] = useState(0);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    (async () => {
      const [m, r] = await Promise.all([fetch("/data/manifest.json").then((x) => x.json()), fetch("/data/rfx/KF-PPE-FY27.json").then((x) => x.json())]);
      setBoot({ manifest: m, published: r });
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
      setSt(saved && saved.rfx ? saved : initialState(r, m));
      setUsed(Number(localStorage.getItem("clearbid-questions") || 0));
      setAuthed(!!getCode() || false);
      fetch("/snapshots/run.json", { method: "HEAD" }).then((x) => setHasSnapshot(x.ok)).catch(() => {});
    })();
  }, []);

  useEffect(() => {
    if (!st) return;
    const slim = { ...st, vendors: Object.fromEntries(Object.entries(st.vendors).map(([k, v]) => [k, { ...v, files: v.files.map(({ blob, ...f }) => f) }])) };
    try { localStorage.setItem(KEY, JSON.stringify(slim)); } catch {}
  }, [st]);

  const patch = useCallback((fn) => setSt((s) => (typeof fn === "function" ? fn(s) : { ...s, ...fn })), []);
  const patchVendor = useCallback((id, p) => setSt((s) => ({ ...s, vendors: { ...s.vendors, [id]: { ...s.vendors[id], ...(typeof p === "function" ? p(s.vendors[id]) : p) } } })), []);

  const askAllowed = used < QUESTION_LIMIT;
  const countQuestion = () => { const n = used + 1; setUsed(n); localStorage.setItem("clearbid-questions", String(n)); };

  // ---------- extraction queue: one vendor at a time (keeps within API rate limits) ----------
  const stRef = useRef(st); stRef.current = st;
  useEffect(() => {
    if (!st || busy.current) return;
    const next = Object.values(st.vendors).find((v) => v.status === "queued");
    if (!next) return;
    busy.current = true;
    (async () => {
      patchVendor(next.id, { status: "reading", progress: "Opening files", error: null });
      try {
        const out = await readVendor(stRef.current.rfx, next, (p) => patchVendor(next.id, { progress: p }));
        patchVendor(next.id, { ...out, status: "done", progress: null, reference: null, overrides: {} });
      } catch (e) {
        patchVendor(next.id, { status: "error", progress: null, error: e.message });
      } finally { busy.current = false; setSt((s) => ({ ...s })); }
    })();
  }, [st, patchVendor]);

  const deliver = (batch) => patch((s) => ({ ...s, vendors: Object.fromEntries(Object.entries(s.vendors).map(([k, v]) =>
    [k, v.batch === batch && v.status === "waiting" ? { ...v, status: "queued", delivered: true } : v])) }));
  const rerun = (id) => patchVendor(id, { status: "queued", error: null });
  const addUpload = (name, files) => {
    const id = "U" + Date.now().toString(36);
    patch((s) => ({ ...s, vendors: { ...s.vendors, [id]: { id, name, short: name.split(" ")[0], received: today(), batch: 0, status: "queued", delivered: true, uploaded: true,
      files: files.map((f, i) => ({ name: f.name, blob: f, role: i === 0 ? "quote" : "attachment" })) } } }));
  };
  const resolveReference = async (id, file) => {
    const v = stRef.current.vendors[id];
    patchVendor(id, { refBusy: true, refError: null });
    try { const ref = await readReference(stRef.current.rfx, v, file); patchVendor(id, { reference: ref, refBusy: false }); }
    catch (e) { patchVendor(id, { refBusy: false, refError: e.message }); }
  };

  const saveRun = () => {
    const snap = { version: 1, savedAt: new Date().toISOString(), rfx_id: st.rfx.rfx_id,
      vendors: Object.fromEntries(Object.values(st.vendors).filter((v) => v.status === "done" && !v.uploaded)
        .map((v) => [v.id, { quote: v.quote, docs: v.docs, secondRead: v.secondRead, sourceNumbers: v.sourceNumbers, readAt: v.readAt }])) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(snap)], { type: "application/json" }));
    a.download = "run.json"; a.click();
  };
  const applySnapshot = (snap) => patch((s) => ({ ...s, sent: true, vendors: Object.fromEntries(Object.entries(s.vendors).map(([k, v]) =>
    snap.vendors[k] ? [k, { ...v, ...snap.vendors[k], status: "done", delivered: true, fromSnapshot: snap.savedAt, overrides: {}, reference: null }] : [k, v])) }));
  const loadRun = async (file) => {
    const snap = file ? JSON.parse(await file.text()) : await fetch("/snapshots/run.json").then((r) => r.json());
    applySnapshot(snap);
  };

  const compState = useMemo(() => st && ({
    rfx: st.rfx, assumptions: st.assumptions,
    vendors: Object.values(st.vendors).filter((v) => v.status === "done" && v.quote).map((v) => ({
      id: v.id, name: v.name, short: v.short, received: v.received, batch: v.batch, quote: v.quote, docs: v.docs,
      secondRead: v.secondRead, reference: v.reference, sourceNumbers: v.sourceNumbers, overrides: v.overrides })),
  }), [st]);
  const comp = useMemo(() => (compState && compState.vendors.length ? buildComparison(compState) : null), [compState]);

  if (!boot || !st) return <div className="gate"><p style={{ color: "#fff" }}>Loading…</p></div>;
  if (!authed) return <Gate onOk={() => setAuthed(true)} />;

  const done = Object.values(st.vendors).filter((v) => v.status === "done").length;
  const total = Object.keys(st.vendors).length;
  const steps = [
    ["rfx", "Draft the RFx", `${st.rfx.lines.length} lines`],
    ["send", "Send to vendors", st.sent ? "Sent" : ""],
    ["responses", "Read responses", `${done} of ${total}`],
    ["compare", "Compare", comp ? `${comp.vendors.length} vendors` : ""],
    ["ask", "Ask the analyst", ""],
  ];
  const go = (step) => patch({ step });
  const reset = () => { if (confirm("Start over? This clears the RFx edits, responses read, and chats in this browser.")) { localStorage.removeItem(KEY); setSt(initialState(boot.published, boot.manifest)); } };

  return (
    <div className="shell">
      <nav className="rail" aria-label="Workflow">
        <div className="brand">Clearbid<small>Quotes in, decisions out</small></div>
        <div className="event"><b>{st.rfx.rfx_id}</b>{st.rfx.title}<br />{st.rfx.buyer_company}</div>
        <ol className="steps">
          {steps.map(([id, label, state], i) => (
            <li key={id}><button aria-current={st.step === id ? "step" : undefined} onClick={() => go(id)}>
              <span className="n">{i + 1}</span>{label}<span className="state">{state}</span></button></li>
          ))}
        </ol>
        <div className="rail-foot">
          <span>AI questions left: {Math.max(0, QUESTION_LIMIT - used)} of {QUESTION_LIMIT}</span>
          <button onClick={reset}>Start over</button>
        </div>
      </nav>
      <main className="main">
        {st.step === "rfx" && <RfxStep st={st} patch={patch} published={boot.published} askAllowed={askAllowed} countQuestion={countQuestion} />}
        {st.step === "send" && <SendStep st={st} patch={patch} go={go} />}
        {st.step === "responses" && <ResponsesStep st={st} deliver={deliver} rerun={rerun} addUpload={addUpload} go={go}
          saveRun={saveRun} loadRun={loadRun} hasSnapshot={hasSnapshot} />}
        {st.step === "compare" && <CompareStep st={st} patch={patch} patchVendor={patchVendor} comp={comp} resolveReference={resolveReference} go={go} />}
        {st.step === "ask" && <AnalystStep st={st} patch={patch} comp={comp} compState={compState} askAllowed={askAllowed} countQuestion={countQuestion} go={go} />}
      </main>
    </div>
  );
}
