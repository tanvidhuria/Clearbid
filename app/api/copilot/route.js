import { anthropic, MODEL, checkAccess, denied, failed } from "../../../lib/server/claude.js";
import { prepareFile } from "../../../lib/server/files.js";
import { COPILOT_SYSTEM, RFX_TOOL } from "../../../lib/server/prompts.js";
export const maxDuration = 300;

export async function POST(req) {
  if (!checkAccess(req)) return denied();
  try {
    const { messages, rfx, attachments = [] } = await req.json();
    const current = `Current RFx draft (JSON):\n${JSON.stringify({ title: rfx.title, lines: rfx.lines, questionnaire: rfx.questionnaire, terms: rfx.terms })}`;
    let hist = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    while (hist.length && hist[0].role !== "user") hist.shift();
    const last = hist.pop();
    const files = await Promise.all(attachments.map(prepareFile));
    hist.push({ role: "user", content: [{ type: "text", text: current }, ...files.flatMap((f) => f.blocks), { type: "text", text: last.content }] });
    let update = null;
    let reply = "";
    let msgs = hist;
    for (let i = 0; i < 3; i++) {
      const res = await anthropic().messages.create({ model: MODEL, max_tokens: 12000, system: COPILOT_SYSTEM, tools: [RFX_TOOL], messages: msgs });
      reply += res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const tu = res.content.find((b) => b.type === "tool_use");
      if (!tu) break;
      update = { ...(update || {}), ...tu.input };
      msgs = [...msgs, { role: "assistant", content: res.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, content: "RFx updated and shown to the buyer." }] }];
    }
    return Response.json({ reply: reply.trim(), update });
  } catch (e) { return failed(e); }
}
