import { ServerResults } from "#features/server-demo/server-results"

export const dynamic = "force-dynamic"

export default function ServerPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">React Server Components</p>
      <h1 className="title">Decisions on the server.</h1>
      <p className="lede">
        Typed evaluators run during this request. Full evaluation details expose provenance,
        payloads, and fallback errors.
      </p>
      <div className="section">
        <ServerResults />
      </div>
    </main>
  )
}
