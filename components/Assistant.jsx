"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, LabelList } from "recharts";
import { api, fileToB64, QUESTION_LIMIT } from "../lib/client/api.js";
import { exportComparisonXlsx, exportAwardDocx } from "../lib/client/exports.js";

const COLORS = ["#1d5a47", "#8f5c00", "#5b6866", "#3f7fa6", "#a3261c"];
const ANALYST_QS = [
  "Compare landed cost across all five vendors. How big is the spread?",
  "Why is Balaji so cheap on nitrile gloves?",
  "Which vendors cleared the quality questionnaire, and why did the others fail?",
  "Split it: cheapest per line, only among qualified vendors. What's the total and the saving versus the best single vendor?",
  "Does Raksha's discount change that answer?",
  "What happens if the dollar moves to ₹92?",
  "If the first-choice vendor falls through, who are the 2nd and 3rd picks for each line?",
  "What is still unresolved before I can award?",
];

function Chart({ b }) {
  const data = b.labels.map((l, i) => Object.fromEntries([["label", l], ...b.series.map((s) => [s.name, s.values[i]])]));
  const horizontal = b.chart_type === "horizontal_bar";
  const h = horizontal ? Math.max(200, b.labels.length * 32 + 50) : 240;
  return (
    <div className="answer-block">
      {b.title && <h4>{b.title}</h4>}
      <div style={{ width: "100%", height: h }}>
        <ResponsiveContainer>
          {b.chart_type === "line" ? (
            <LineChart data={data}><CartesianGrid stroke="#e3e7e3" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />{b.series.length > 1 && <Legend />}
              {b.series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={COLORS[i % 5]} strokeWidth={2} />)}</LineChart>
          ) : (
            <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 16, left: horizontal ? 10 : 0, right: 30 }}>
              <CartesianGrid stroke="#e3e7e3" />
              {horizontal ? <><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={100} /></>
                : <><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={40} /></>}
              <Tooltip />{b.series.length > 1 && <Legend />}
              {b.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % 5]}><LabelList dataKey={s.name} position={horizontal ? "right" : "top"} style={{ fontSize: 11, fill: "#1c2a28" }} formatter={(v) => (typeof v === "number" ? v.toLocaleString("en-IN") : v)} /></Bar>)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {b.value_label && <div className="small muted">Values in {b.value_label}</div>}
    </div>
  );
}

function Answer({ a, comp }) {
  const lastScenario = (a.scenarios || []).filter((s) => s.result?.allocation).slice(-1)[0];
  return (
    <div className="msg ai" style={{ maxWidth: "100%", width: "100%" }}>
      <div className="bubble">{a.blocked ? <p className="err">{a.text}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.text || "Done."}</ReactMarkdown>}</div>
      {(a.blocks || []).map((b, i) => b.type === "table" ? (
        <div key={i} className="answer-block scroll-x">
          {b.title && <h4>{b.title}</h4>}
          <table className="plain"><thead><tr>{b.columns.map((c, j) => <th key={c} className={/^[₹$\d\-+(]/.test(String(b.rows[0]?.[j] ?? "")) ? "r" : ""}>{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((x, j) => <td key={j} className={/^[₹$\d\-+(]/.test(String(x)) ? "r" : ""}>{x}</td>)}</tr>)}</tbody></table>
        </div>
      ) : <Chart key={i} b={b} />)}
      {a.verified && a.toolsUsed?.some((t) => !["update_rfx", "navigate", "send_rfx", "receive_replies", "load_saved_run", "use_last_year_po", "draft_clarification", "download"].includes(t)) &&
        <div className="verified">✓ Every number here matches Clearbid's calculations.</div>}
      {lastScenario && comp && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => exportComparisonXlsx(comp, lastScenario)}>Award (Excel)</button>
          <button className="btn small" onClick={() => exportAwardDocx(comp, lastScenario, a.text)}>Award note (Word)</button>
        </div>
      )}
    </div>
  );
}

export default function Assistant({ st, patch, comp, compState, status, askAllowed, countQuestion, onActions }) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const log = useRef(null);
  const ref = useRef({}); ref.current = { st, compState, status };
  useEffect(() => { log.current?.scrollTo(0, 1e6); }, [st.chat.length, busy]);

  useEffect(() => {
    if (busy || !queue.length) return;
    const { text, files: qf } = queue[0];
    setBusy(true);
    (async () => {
      const cur = ref.current;
      const shown = text + (qf.length ? `\n(Attached: ${qf.map((f) => f.name).join(", ")})` : "");
      const msgs = [...cur.st.chat, { role: "user", content: shown }];
      patch({ chat: msgs });
      try {
        const attachments = await Promise.all(qf.map((f) => fileToB64(f, f.name)));
        const history = msgs.map((m) => ({ role: m.role, content: m.role === "assistant" ? (m.answer?.text || "Done.") : m.content }));
        const state = cur.compState || { rfx: cur.st.rfx, assumptions: cur.st.assumptions, vendors: [] };
        const r = await api("/api/assistant", { messages: history, state: { ...state, rfx: cur.st.rfx }, status: cur.status, attachments });
        patch((s) => ({ ...s, chat: [...msgs, { role: "assistant", answer: r }],
          rfx: r.rfxUpdate ? { ...s.rfx, ...Object.fromEntries(Object.entries(r.rfxUpdate).filter(([, v]) => v !== undefined)) } : s.rfx }));
        if (r.actions?.length) onActions(r.actions, r);
      } catch (e) { setErr(e.message); }
      setQueue((q) => q.slice(1)); setBusy(false);
    })();
  }, [queue, busy, patch, onActions]);

  const ask = (text) => {
    const q = (text ?? input).trim();
    if (!q) return;
    if (!askAllowed) { setErr(`You've used all ${QUESTION_LIMIT} AI questions for this demo in this browser.`); return; }
    countQuestion(); setErr(""); setInput("");
    setQueue((qq) => [...qq, { text: q, files }]); setFiles([]);
  };

  const read = !!comp;
  const ideas = !read
    ? [!st.sent ? "Add an exchange rate clause for imported items" : null, !st.sent ? "Send the RFx to all vendors" : "Receive the first replies", "Load the saved run"].filter(Boolean)
    : ANALYST_QS.filter((q) => !st.chat.some((m) => m.content === q)).slice(0, 3);

  return (
    <aside className="assistant" aria-label="Clearbid assistant">
      <header className="assistant-head">
        <div><b>Clearbid assistant</b><div className="small muted">Drafts, runs and answers. One conversation.</div></div>
      </header>
      <div className="chat-log" ref={log}>
        {!st.chat.length && (
          <div className="msg ai"><div className="bubble">
            <p>Hi, I'm your sourcing assistant for {st.rfx.rfx_id}. Ask me to change the RFx, send it, receive and read replies, or answer anything about the quotes, all from here.</p>
          </div></div>
        )}
        {st.chat.map((m, i) => m.role === "user" ? <div key={i} className="msg user">{m.content}</div> : <Answer key={i} a={m.answer || {}} comp={comp} />)}
        {busy && <div className="thinking">Working on it</div>}
        {queue.length > 1 && <div className="small muted">Queued next: {queue.slice(1).map((q) => q.text).join("; ")}</div>}
      </div>
      <div className="suggest">{ideas.map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}</div>
      {err && <p className="err small" style={{ padding: "0 14px" }}>{err}</p>}
      {files.length > 0 && <p className="small muted" style={{ padding: "0 14px" }}>Attached: {files.map((f) => f.name).join(", ")}</p>}
      <div className="chat-input">
        <label className="btn" title="Attach a file">+<input type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.txt" onChange={(e) => setFiles([...e.target.files])} /></label>
        <textarea rows={2} value={input} placeholder="Ask or tell Clearbid what to do" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <button className="btn primary" onClick={() => ask()} disabled={!input.trim()}>{busy ? "Queue" : "Send"}</button>
      </div>
    </aside>
  );
}
