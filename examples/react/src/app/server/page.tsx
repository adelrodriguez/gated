import { ServerResults } from "#features/server-demo/server-results"
import { ShowcaseIntro } from "#features/shell/showcase-intro"

export const dynamic = "force-dynamic"

export default function ServerPage() {
  return (
    <main className="shell page">
      <ShowcaseIntro eyebrow="details() · batch() · decideMany" title="Server evaluation" />
      <ServerResults />
    </main>
  )
}
