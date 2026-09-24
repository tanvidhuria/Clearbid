import { callTool, checkAccess, denied, failed } from "../../../lib/server/claude.js";
import { CLARIFY_SYSTEM, EMAIL_TOOL } from "../../../lib/server/prompts.js";
export const maxDuration = 120;
export async function POST(req) {
  if (!checkAccess(req)) return denied();
  try {
    const { vendor, contact, rfx_id, asks } = await req.json();
    const text = `Vendor: ${vendor}${contact ? ` (contact: ${contact})` : ""}\nRFx: ${rfx_id}\nThings to ask for:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
    const out = await callTool({ system: CLARIFY_SYSTEM, content: [{ type: "text", text }], tool: EMAIL_TOOL, max_tokens: 1500 });
    return Response.json(out.data);
  } catch (e) { return failed(e); }
}
