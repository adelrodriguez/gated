import { demoProvider } from "#shared/demo-provider/adapter"
import { getProviderCalls } from "#shared/demo-provider/store"

export async function POST(request: Request) {
  const body = (await request.json()) as { keys?: unknown; identity?: { distinctId?: unknown } }
  if (
    !Array.isArray(body.keys) ||
    !body.keys.every((key) => typeof key === "string") ||
    typeof body.identity?.distinctId !== "string"
  )
    return Response.json({ error: "Invalid request" }, { status: 400 })
  try {
    const result = await demoProvider.decideMany(
      body.keys,
      { distinctId: body.identity.distinctId },
      { signal: request.signal }
    )
    return Response.json(result, { headers: { "x-provider-calls": String(getProviderCalls()) } })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Decision failed" },
      { status: 500 }
    )
  }
}
