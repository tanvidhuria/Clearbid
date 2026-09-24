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

// Force a single structured tool call and return its input
export async function callTool({ system, content, tool, max_tokens = 8000 }) {
  const res = await anthropic().messages.create({
    model: MODEL, max_tokens, system,
    tools: [tool], tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("The AI did not return structured output");
  return { data: block.input, usage: res.usage, stop: res.stop_reason };
}
