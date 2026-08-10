import { AdvancedResults } from "#features/advanced/advanced-results"
import { ShowcaseIntro } from "#features/shell/showcase-intro"

export const dynamic = "force-dynamic"

export default function AdvancedPage() {
  return (
    <main className="shell page">
      <ShowcaseIntro eyebrow="hooks · fallback · cancellation" title="Evaluation lifecycle" />
      <AdvancedResults />
    </main>
  )
}
