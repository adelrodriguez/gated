import { AdvancedResults } from "#features/advanced/advanced-results"

export const dynamic = "force-dynamic"

export default function AdvancedPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">Hooks, recipes, cancellation</p>
      <h1 className="title">The full evaluation lifecycle.</h1>
      <p className="lede">
        Run each focused experiment and inspect the shared event log. Select Anonymous above to see
        null identity flow through the anonymous factory.
      </p>
      <AdvancedResults />
    </main>
  )
}
