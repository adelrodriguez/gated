import { MatrixTable } from "#features/matrix/matrix-table"
import { ShowcaseIntro } from "#features/shell/showcase-intro"

export const dynamic = "force-dynamic"

export default function MatrixPage() {
  return (
    <main className="shell page">
      <ShowcaseIntro eyebrow="identity override · batch()" title="Identity matrix" />
      <MatrixTable />
    </main>
  )
}
