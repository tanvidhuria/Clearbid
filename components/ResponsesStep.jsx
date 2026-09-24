"use client";
import { useEffect, useState } from "react";

const STATUS = {
  waiting: ["grey", "Not received yet"], queued: ["warn", "Waiting to be read"], reading: ["warn", "Reading"],
  done: ["ok", "Read"], error: ["bad", "Couldn't read"],
};

function EmailBody({ url }) {
  const [t, setT] = useState("");
  useEffect(() => { fetch(url).then((r) => r.text()).then((x) => setT(x.split(/\n\n/).slice(1).join("\n\n").trim())).catch(() => {}); }, [url]);
  return t ? <div className="email-preview">{t}</div> : null;
}

export default function ResponsesStep({ st, deliver, rerun, addUpload, go, saveRun, loadRun, hasSnapshot }) {
  const vendors = Object.values(st.vendors);
  const waiting = (b) => vendors.some((v) => v.batch === b && v.status === "waiting");
  const done = vendors.filter((v) => v.status === "done").length;
  const busy = vendors.some((v) => v.status === "reading" || v.status === "queued");
  const [upName, setUpName] = useState("");
  const [upFiles, setUpFiles] = useState([]);
  const [loadErr, setLoadErr] = useState("");

  const load = async (file) => { setLoadErr(""); try { await loadRun(file); } catch (e) { setLoadErr("That file isn't a Clearbid saved run."); } };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Read responses</h1>
          <p>Vendors reply however they like. Each response is read live by AI: prices and terms first, then every attachment and the questionnaire. Photos are read twice, independently.</p>
        </div>
        <div className="row">
          {waiting(1) && <button className="btn primary" onClick={() => deliver(1)}>Receive first 3 replies</button>}
          {!waiting(1) && waiting(2) && <button className="btn primary" onClick={() => deliver(2)}>Receive the last 2 replies</button>}
          {done > 0 && !busy && <button className="btn primary" onClick={() => go("compare")}>Compare {done} responses</button>}
        </div>
      </div>

      {!st.sent && <p className="notice small" style={{ marginBottom: 14 }}>The RFx hasn't been sent yet. You can still receive replies; they were written against RFx {st.rfx.rfx_id}.</p>}

      <section className="panel" aria-label="Inbox">
        {vendors.map((v) => {
          const [tone, label] = STATUS[v.status] || STATUS.waiting;
          const email = v.files.find((f) => f.role === "email");
          return (
            <div className="vendor-row" key={v.id}>
              <div>
                <h3>{v.name}</h3>
                <div className="small muted">{v.status === "waiting" ? `Expected around ${v.received}` : `Received ${v.received}`}</div>
              </div>
              <div>
                {v.status === "waiting" ? <p className="muted small">Nothing yet.</p> : (<>
                  <div className="files">
                    {v.files.map((f) => f.url
                      ? <a key={f.name} className="file" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                      : <span key={f.name} className="file">{f.name}</span>)}
                  </div>
                  {email?.url && <EmailBody url={email.url} />}
                  {v.progress && <p className="thinking" style={{ marginTop: 8 }}>{v.progress}</p>}
                  {v.error && <p className="err small" style={{ marginTop: 8 }}>{v.error}</p>}
                  {v.status === "done" && (
                    <p className="small muted" style={{ marginTop: 8 }}>
                      {(v.quote?.lines || []).filter((l) => l.status !== "not_quoted").length} of {st.rfx.lines.length} lines found,{" "}
                      {(v.docs?.documents || []).length} documents checked.
                      {v.fromSnapshot ? ` Loaded from a saved run (${new Date(v.fromSnapshot).toLocaleString("en-IN")}).` : v.readAt ? ` Read live ${new Date(v.readAt).toLocaleTimeString("en-IN")}.` : ""}
                      {v.truncated && <span className="err"> The reply was cut short; re-run to read it fully.</span>}
                    </p>
                  )}
                </>)}
              </div>
              <div className="row" style={{ flexDirection: "column", alignItems: "flex-end" }}>
                <span className={`chip ${tone}`}>{label}</span>
                {(v.status === "done" || v.status === "error") && v.files.every((f) => f.url || f.blob) &&
                  <button className="btn ghost small" onClick={() => rerun(v.id)}>Re-run live</button>}
              </div>
            </div>
          );
        })}
      </section>

      <div className="split" style={{ marginTop: 18, gridTemplateColumns: "1fr 1fr" }}>
        <section className="panel panel-pad">
          <h3>Try your own file</h3>
          <p className="small muted">Upload any quotation (PDF, Excel, Word, photo or text). It is read against this RFx exactly like the others.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="btn" style={{ flex: 1, minWidth: 160 }} placeholder="Vendor name" value={upName} onChange={(e) => setUpName(e.target.value)} />
            <label className="btn">Choose files<input type="file" hidden multiple onChange={(e) => setUpFiles([...e.target.files])} /></label>
            <button className="btn primary" disabled={!upName || !upFiles.length} onClick={() => { addUpload(upName, upFiles); setUpName(""); setUpFiles([]); }}>Read it</button>
          </div>
          {upFiles.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>{upFiles.map((f) => f.name).join(", ")}</p>}
        </section>
        <section className="panel panel-pad">
          <h3>Saved runs</h3>
          <p className="small muted">Reading all five responses live takes a few minutes. A saved run holds the AI's earlier readings, so a reviewer can skip the wait. Re-run any vendor live at any time.</p>
          <div className="row" style={{ marginTop: 8 }}>
            {hasSnapshot && <button className="btn" onClick={() => load()}>Load the saved run</button>}
            <label className="btn">Load from file<input type="file" hidden accept=".json" onChange={(e) => e.target.files[0] && load(e.target.files[0])} /></label>
            <button className="btn" disabled={!done} onClick={saveRun}>Save this run</button>
          </div>
          {loadErr && <p className="err small">{loadErr}</p>}
        </section>
      </div>
    </>
  );
}
