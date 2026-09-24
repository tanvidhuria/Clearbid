"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, LabelList } from "recharts";
import { api } from "../lib/client/api.js";
import { exportComparisonXlsx, exportAwardDocx } from "../lib/client/exports.js";
import { QUESTION_LIMIT } from "../lib/client/api.js";

const QUESTIONS = [
  "Compare landed cost across all five vendors. How big is the spread?",
  "Why is Balaji so cheap on nitrile gloves?",
  "Which vendors cleared the quality questionnaire, and why did the others fail?",
  "Split it: cheapest per line, only among qualified vendors. What's the total and the saving versus the best single vendor?",
  "Does Raksha's discount change that answer?",
  "What happens if the dollar moves to ₹92?",
  "Which lines have only one qualified bidder?",
  "If the first-choice vendor falls through, who are the 2nd and 3rd picks for each line?",
  "What is still unresolved before I can award?",
];
const COLORS = ["#1d5a47", "#8f5c00", "#5b6866", "#3f7fa6", "#a3261c"];

function Chart({ b }) {
  const data = b.labels.map((l, i) => Object.fromEntries([["label", l], ...b.series.map((s) => [s.name, s.values[i]])]));
  const horizontal = b.chart_type === "horizontal_bar";
  const h = horizontal ? Math.max(220, b.labels.length * 34 + 60) : 280;
  return (
    <div className="answer-block">
      {b.title && <h4>{b.title}</h4>}
      <div style={{ width: "100%", height: h }}>
        <ResponsiveContainer>
          {b.chart_type === "line" ? (
            <LineChart data={data}><CartesianGrid stroke="#e3e7e3" /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />{b.series.length > 1 && <Legend />}
              {b.series.map((s, i) => <Line key={s.name} dataKey={s.name} stroke={COLORS[i % 5]} strokeWidth={2} />)}</LineChart>
          ) : (
            <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 30 : 0 }}>
              <CartesianGrid stroke="#e3e7e3" />
              {horizontal ? <><XAxis type="number" tick={{ fontSize: 12 }} /><YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={130} /></>
                : <><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /></>}
              <Tooltip />{b.series.length > 1 && <Legend />}
              {b.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % 5]}><LabelList dataKey={s.name} position={horizontal ? "right" : "top"} style={{ fontSize: 12, fill: "#1c2a28" }} formatter={(v) => (typeof v === "number" ? v.toLocaleString("en-IN") : v)} /></Bar>)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {b.value_label && <div className="small muted">Values in {b.value_label}</div>}
    </div>
  );
}

function Answer({ m, comp }) {
  const a = m.answer || {};
  const lastScenario = (a.scenarios || []).filter((s) => s.result?.allocation).slice(-1)[0];
  return (
    <div className="msg ai" style={{ maxWidth: "100%", width: "100%" }}>
      <div className="bubble">
        {a.blocked ? <p className="err">{a.text}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.text || ""}</ReactMarkdown>}
      </div>
      {(a.blocks || []).map((b, i) => b.type === "table" ? (
        <div key={i} className="answer-block scroll-x">
          {b.title && <h4>{b.title}</h4>}
          <table className="plain"><thead><tr>{b.columns.map((c, j) => <th key={c} className={/^[₹$\d\-+(]/.test(String(b.rows[0]?.[j] ?? "")) ? "r" : ""}>{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((x, j) => <td key={j} className={/^[₹$\d\-+(]/.test(String(x)) ? "r" : ""}>{x}</td>)}</tr>)}</tbody></table>
        </div>
      ) : <Chart key={i} b={b} />)}
      {a.verified && <div className="verified">✓ Every number here matches Clearbid's calculations.{a.toolsUsed?.length ? ` Used: ${[...new Set(a.toolsUsed)].map((t) => t.replace(/_/g, " ")).join(", ")}.` : ""}</div>}
      {a.blocked && a.unverified && <div className="small muted">Unmatched: {a.unverified.join(", ")}</div>}
      {lastScenario && comp && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => exportComparisonXlsx(comp, lastScenario)}>Download award (Excel)</button>
          <button className="btn" onClick={() => exportAwardDocx(comp, lastScenario, a.text)}>Award note (Word)</button>
        </div>
      )}
    </div>
  );
}

export default function AnalystStep({ st, patch, comp, compState, askAllowed, countQuestion, go }) {
  const [input, setInput] = useState("");
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const log = useRef(null);
  const stRef = useRef(st); stRef.current = st;
  const stateRef = useRef(compState); stateRef.current = compState;
  useEffect(() => { log.current?.scrollTo(0, 1e6); }, [st.analyst.length, busy]);

  useEffect(() => {
    if (busy || !queue.length) return;
    const q = queue[0];
    setBusy(true);
    (async () => {
      const msgs = [...stRef.current.analyst, { role: "user", content: q }];
      patch({ analyst: msgs });
      try {
        const history = msgs.map((m) => ({ role: m.role, content: m.role === "assistant" ? (m.answer?.text || "") : m.content })).filter((m) => m.content);
        const r = await api("/api/analyst", { messages: history, state: stateRef.current });
        patch((s) => ({ ...s, analyst: [...msgs, { role: "assistant", answer: r }] }));
      } catch (e) { setErr(e.message); }
      setQueue((qq) => qq.slice(1)); setBusy(false);
    })();
  }, [queue, busy, patch]);

  if (!comp) return (<>
    <div className="page-head"><div><h1>Ask the analyst</h1></div></div>
    <p className="notice">Read at least one vendor response first. <button className="btn ghost" onClick={() => go("responses")}>Go to responses</button></p>
  </>);

  const ask = (text) => {
    const q = (text ?? input).trim();
    if (!q) return;
    if (!askAllowed) { setErr(`You've used all ${QUESTION_LIMIT} AI questions for this demo in this browser.`); return; }
    countQuestion(); setErr(""); setInput("");
    setQueue((qq) => [...qq, q]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ask the analyst</h1>
          <p>Ask in plain language. Answers come from calculations over the extracted data, never from the AI's memory, and every number is checked before you see it.</p>
        </div>
        <div className="row"><button className="btn" onClick={() => exportComparisonXlsx(comp)}>Download comparison (Excel)</button></div>
      </div>
      <section className="panel chat" style={{ height: "calc(100vh - 150px)" }}>
        <div className="chat-log" ref={log}>
          {!st.analyst.length && <div className="msg ai"><div className="bubble"><p>I have {comp.vendors.length} vendor responses covering {comp.rfx.lines.length} RFx lines. Ask about cost, qualification, risk or a split award. Pick a question below or write your own.</p></div></div>}
          {st.analyst.map((m, i) => m.role === "user" ? <div key={i} className="msg user">{m.content}</div> : <Answer key={i} m={m} comp={comp} />)}
          {busy && <div className="thinking">Working it out with Clearbid's calculations</div>}
          {queue.length > 1 && <div className="small muted">Queued next: {queue.slice(1).join("; ")}</div>}
        </div>
        <div className="suggest">{QUESTIONS.filter((q) => !st.analyst.some((m) => m.content === q)).slice(0, 5).map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}</div>
        {err && <p className="err small" style={{ padding: "0 14px" }}>{err}</p>}
        <div className="chat-input">
          <textarea rows={2} value={input} placeholder="Ask about this sourcing event" onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          <button className="btn primary" onClick={() => ask()} disabled={!input.trim()}>{busy ? "Queue question" : "Ask"}</button>
        </div>
      </section>
    </>
  );
}
