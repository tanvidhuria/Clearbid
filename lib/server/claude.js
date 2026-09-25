import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

let client;
export function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });
  return client;
}

export function checkAccess(req) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  return req.headers.get("x-access-code") === code;
}

export function denied() {
  return Response.json({ error: "Access code missing or wrong. Reload and enter the code from the submission email." }, { status: 401 });
}

export function failed(e) {
  const msg = e?.status === 429 ? "The AI is busy (rate limit). Wait a minute and try again."
    : e?.status === 401 ? "The server's AI key is invalid."
      : e?.message || "Something went wrong";
  return Response.json({ error: msg }, { status: 500 });
}

// Find where the first JSON value in s ends (string-aware)
function jsonEnd(s) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}
// Parse JSON that may have stray markup after it, or an object closed too early
export function parseLoose(text) {
  let s = text.trim();
  const last = s.lastIndexOf("}");
  const lastA = s.lastIndexOf("]");
  s = s.slice(0, Math.max(last, lastA) + 1);
  try { return JSON.parse(s); } catch {}
  const end = jsonEnd(s);
  if (end < 0) return null;
  let out;
  try { out = JSON.parse(s.slice(0, end)); } catch { return null; }
  let rest = s.slice(end).trim();
  while (rest.startsWith(",")) {
    try { const more = JSON.parse("{" + rest.slice(1)); return { ...out, ...more }; } catch {}
    const e2 = jsonEnd("{" + rest.slice(1));
    if (e2 < 0) break;
    try { out = { ...out, ...JSON.parse("{" + rest.slice(1, e2 - 1) + "}") }; } catch { break; }
    rest = rest.slice(e2 - 1).trim();
  }
  return out;
}

// Models occasionally return the whole object as a JSON string inside one field. Unpack it.
export function repairToolInput(input, requiredKeys = []) {
  let data = { ...input };
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!(t.startsWith("{") || t.startsWith("["))) continue;
    const parsed = parseLoose(t);
    if (parsed === null || parsed === undefined) continue;
    if (!Array.isArray(parsed) && typeof parsed === "object" && (parsed[k] !== undefined || requiredKeys.some((r) => r in parsed))) data = { ...data, ...parsed };
    else data[k] = parsed;
  }
  return data;
}

// Force a single structured tool call and return its input
export async function callTool({ system, content, tool, max_tokens = 8000 }) {
  const res = await anthropic().messages.create({
    model: MODEL, max_tokens, system,
    tools: [tool], tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("The AI did not return structured output");
  return { data: repairToolInput(block.input, tool.input_schema.required || []), usage: res.usage, stop: res.stop_reason };
}
