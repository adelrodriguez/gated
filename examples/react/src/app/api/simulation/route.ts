import { setFlakyKnobs } from "#shared/demo-provider/store"

export async function POST(request: Request) {
  const body = (await request.json()) as { latencyMs?: unknown; fail?: unknown }
  if (typeof body.latencyMs !== "number" || typeof body.fail !== "boolean")
    return Response.json({ error: "Invalid request" }, { status: 400 })
  setFlakyKnobs(body.latencyMs, body.fail)
  return Response.json({ ok: true })
}
