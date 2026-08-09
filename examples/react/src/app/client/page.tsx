import { ClientDemo } from "#features/client-demo/client-demo"
import { ShowcaseIntro } from "#features/shell/showcase-intro"

export const dynamic = "force-dynamic"

export default function ClientPage() {
  return (
    <main className="shell page">
      <ShowcaseIntro eyebrow="createReactGate · FeatureGate" title="React integration" />
      <ClientDemo />
    </main>
  )
}
