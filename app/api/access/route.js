export async function POST(req) {
  const { code } = await req.json().catch(() => ({}));
  const expected = process.env.ACCESS_CODE;
  if (!expected || code === expected) return Response.json({ ok: true, aiConfigured: !!process.env.ANTHROPIC_API_KEY });
  return Response.json({ ok: false, error: "That code doesn't match. Use the access code from the submission email." }, { status: 401 });
}
