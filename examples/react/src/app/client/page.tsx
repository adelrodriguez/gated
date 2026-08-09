import { ClientShowcase } from "#features/client-demo/client-showcase"

export const dynamic = "force-dynamic"

const cacheSnippet = `const cache = createReactGateCache()
const usePlan = createReactGate(planGate, { cache })
// On the server: create and inject one cache per request.`

export default function ClientPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">React 19 + Suspense</p>
      <h1 className="title">Cache-aware client gates.</h1>
      <p className="lede">
        Flip a flag in Admin: this page keeps its cached value. Invalidate the selected identity to
        re-fetch, or clear every React gate cache.
      </p>
      <div className="section">
        <ClientShowcase />
      </div>
      <section className="card section">
        <h2>SSR cache injection</h2>
        <p className="muted">
          A shared module cache on the server can retain identities across requests. Inject a
          request-owned cache instead.
        </p>
        <pre>{cacheSnippet}</pre>
      </section>
    </main>
  )
}
