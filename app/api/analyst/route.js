import { anthropic, MODEL, checkAccess, denied, failed } from "../../../lib/server/claude.js";
import { ANALYST_SYSTEM, ANALYST_TOOLS } from "../../../lib/server/prompts.js";
import { overview, getLines, vendorDetails, runScenario, fxSensitivity, openIssues } from "../../../lib/scenarios.js";
import { allowedNumbers, unverifiedNumbers } from "../../../lib/verify.js";

export const maxDuration = 300;

function runTool(name, input, state) {
  switch (name) {
    case "get_overview": return overview(state);
    case "get_lines": return getLines(state, input);
    case "get_vendor_details": return vendorDetails(state, input);
    case "run_award_scenario": return runScenario(state, input);
    case "fx_sensitivity": return fxSensitivity(state, input);
    case "list_open_issues": return openIssues(state);
    default: return { error: `Unknown tool ${name}` };
  }
}

export async function POST(req) {
  if (!checkAccess(req)) return denied();
  try {
    const { messages, state } = await req.json();
    let history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    while (history.length && history[0].role !== "user") history.shift();
    const question = history[history.length - 1]?.content || "";
    let msgs = history;
    const toolTexts = [question, JSON.stringify(state.assumptions)];
    const scenarios = [];
    const toolsUsed = [];
    let blocks = [];
    let text = "";
    let retried = false;

    for (let turn = 0; turn < 10; turn++) {
      const res = await anthropic().messages.create({ model: MODEL, max_tokens: 6000, system: ANALYST_SYSTEM, tools: ANALYST_TOOLS, messages: msgs });
      const uses = res.content.filter((b) => b.type === "tool_use");
      const turnText = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!uses.length) {
        text = turnText;
        const check = [text, ...blocks.map((b) => b.type === "table" ? b.rows.flat().join(" ") : b.series.flatMap((s) => s.values).join(" "))].join("\n");
        const bad = unverifiedNumbers(check, allowedNumbers(toolTexts));
        if (bad.length && !retried) {
          retried = true;
          blocks = [];
          msgs = [...msgs, { role: "assistant", content: res.content },
            { role: "user", content: `Check failed: these numbers do not appear in any tool result: ${bad.join(", ")}. Rewrite the whole answer (and any tables or charts) using only numbers returned by tools. Call tools again if you need a computed figure.` }];
          continue;
        }
        if (bad.length) {
          return Response.json({ blocked: true, unverified: bad, toolsUsed,
            text: "I couldn't match every number in my answer to Clearbid's calculations, so I'm not showing it. Try asking in a narrower way, for example about one vendor or one scenario." });
        }
        return Response.json({ text, blocks, scenarios, toolsUsed, verified: true });
      }
      const results = [];
      for (const u of uses) {
        toolsUsed.push(u.name);
        let out;
        if (u.name === "render_table") { blocks.push({ type: "table", ...u.input }); out = "Table shown to the buyer."; }
        else if (u.name === "render_chart") { blocks.push({ type: "chart", ...u.input }); out = "Chart shown to the buyer."; }
        else {
          const r = runTool(u.name, u.input, state);
          if (u.name === "run_award_scenario" && !r.error) scenarios.push({ input: u.input, result: r });
          out = JSON.stringify(r);
          toolTexts.push(out);
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      msgs = [...msgs, { role: "assistant", content: res.content }, { role: "user", content: results }];
    }
    return Response.json({ text: text || "I ran out of steps before finishing. Try a narrower question.", blocks, scenarios, toolsUsed, verified: false });
  } catch (e) { return failed(e); }
}
