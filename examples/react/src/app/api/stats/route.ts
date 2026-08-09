import { getProviderCalls } from "#shared/demo-provider/store"

export const dynamic = "force-dynamic"
export function GET() {
  return Response.json({ providerCalls: getProviderCalls() })
}
