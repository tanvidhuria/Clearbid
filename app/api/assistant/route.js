import { anthropic, MODEL, checkAccess, denied, failed } from "../../../lib/server/claude.js";
import { prepareFile } from "../../../lib/server/files.js";
import { ASSISTANT_SYSTEM, ASSISTANT_TOOLS } from "../../../lib/server/prompts.js";
import { overview, getLines, vendorDetails, runScenario, fxSensitivity, openIssues } from "../../../lib/scenarios.js";
import { allowedNumbers, unverifiedNumbers } from "../../../lib/verify.js";

export const maxDuration = 300;
const ACTIONS = new Set(["navigate", "send_rfx", "receive_replies", "load_saved_run", "add_vendor_response", "use_last_year_po", "draft_clarifications", "download"]);
const DATA = { get_overview: overview, get_lines: getLines, get_vendor_details: vendorDetails, run_award_scenario: runScenario,
  fx_sensitivity: fxSensitivity, list_open_issues: openIssues };

export async function POST(req) {
  if (!checkAccess(req)) return denied();
  try {
    const { messages, state, status, attachments = [] } = await req.json();
    let history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    while (history.length && history[0].role !== "user") history.shift();
    const last = history.pop();
    const files = await Promise.all(attachments.map(prepareFile));
    const context = `App status: ${JSON.stringify(status)}\nCurrent RFx: ${JSON.stringify({ rfx_id: state.rfx.rfx_id, title: state.rfx.title, lines: state.rfx.lines, questionnaire: state.rfx.questionnaire, terms: state.rfx.terms })}`;
    let msgs = [...history, { role: "user", content: [{ type: "text", text: context }, ...files.flatMap((f) => f.blocks), { type: "text", text: last.content }] }];

    let working = { ...state };
    const toolTexts = [last.content, JSON.stringify(state.assumptions), JSON.stringify(state.rfx), JSON.stringify(status)];
    const scenarios = [], toolsUsed = [], actions = [];
    let blocks = [], parts = [], rfxUpdate = null, retried = false;

    for (let turn = 0; turn < 10; turn++) {
      const res = await anthropic().messages.create({ model: MODEL, max_tokens: 8000, system: ASSISTANT_SYSTEM, tools: ASSISTANT_TOOLS, messages: msgs });
      const uses = res.content.filter((b) => b.type === "tool_use");
      const turnText = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (turnText) parts.push(turnText);
      if (!uses.length) {
        const text = parts.join("\n\n");
        const check = [text, ...blocks.map((b) => b.type === "table" ? b.rows.flat().join(" ") : b.series.flatMap((s) => s.values).join(" "))].join("\n");
        const bad = unverifiedNumbers(check, allowedNumbers(toolTexts));
        if (bad.length && !retried) {
          retried = true; blocks = []; parts = [];
          msgs = [...msgs, { role: "assistant", content: res.content },
            { role: "user", content: `Check failed: these numbers do not appear in any tool result: ${bad.join(", ")}. Rewrite the whole answer (and any tables or charts) using only numbers returned by tools. Call tools again if you need a computed figure.` }];
          continue;
        }
        if (bad.length) return Response.json({ blocked: true, unverified: bad, toolsUsed, actions, rfxUpdate,
          text: "I couldn't match every number in my answer to Clearbid's calculations, so I'm not showing it. Try asking in a narrower way, for example about one vendor or one scenario." });
        return Response.json({ text, blocks, scenarios, toolsUsed, actions, rfxUpdate, verified: true });
      }
      const results = [];
      for (const u of uses) {
        toolsUsed.push(u.name);
        let out;
        if (u.name === "render_table") { blocks.push({ type: "table", ...u.input }); out = "Table shown to the buyer."; }
        else if (u.name === "render_chart") { blocks.push({ type: "chart", ...u.input }); out = "Chart shown to the buyer."; }
        else if (u.name === "update_rfx") {
          rfxUpdate = { ...(rfxUpdate || {}), ...u.input };
          working = { ...working, rfx: { ...working.rfx, ...u.input } };
          toolTexts.push(JSON.stringify(u.input));
          out = "RFx updated and shown to the buyer.";
        } else if (ACTIONS.has(u.name)) {
          actions.push({ name: u.name, input: u.input });
          out = "The app will do this right after your reply.";
        } else if (DATA[u.name]) {
          if (!working.vendors?.length) out = JSON.stringify({ error: "No vendor responses have been read yet. Offer to receive replies or load the saved run." });
          else {
            const r = DATA[u.name](working, u.input);
            if (u.name === "run_award_scenario" && !r.error) scenarios.push({ input: u.input, result: r });
            out = JSON.stringify(r);
          }
          toolTexts.push(out);
        } else out = `Unknown tool ${u.name}`;
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      msgs = [...msgs, { role: "assistant", content: res.content }, { role: "user", content: results }];
    }
    return Response.json({ text: parts.join("\n\n") || "I ran out of steps before finishing. Try a narrower question.", blocks, scenarios, toolsUsed, actions, rfxUpdate, verified: false });
  } catch (e) { return failed(e); }
}
