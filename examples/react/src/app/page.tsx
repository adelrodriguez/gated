import Link from "next/link"

export const dynamic = "force-dynamic"

const demos = [
  [
    "/admin",
    "Admin controls",
    "Toggle global decisions, user overrides, variants, latency, and failures.",
  ],
  [
    "/server",
    "Server evaluation",
    "Inspect details, provenance, payloads, fallbacks, batch, and decideMany.",
  ],
  [
    "/client",
    "React integration",
    "Use createReactGate, Suspense, FeatureGate, invalidation, and custom cache keys.",
  ],
  [
    "/matrix",
    "Identity matrix",
    "Compare divergent decisions with an explicit identity override per row.",
  ],
  [
    "/advanced",
    "Advanced",
    "See hooks, dedupe, cache, timeouts, aborts, typed failures, and anonymous mode.",
  ],
] as const

export default function OverviewPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">Provider-agnostic feature flags</p>
      <h1 className="title">
        One tiny API.
        <br />
        Every evaluation path.
      </h1>
      <p className="lede">
        This live Next.js app exercises every public capability of <strong>gated</strong> against a
        local in-memory provider. Switch identities, edit decisions, and follow the lifecycle from
        store to server or client.
      </p>
      <section className="card section">
        <p className="eyebrow">Architecture</p>
        <div className="architecture">
          <div>
            <strong>Server factory</strong>
            <small>RSC · actions · batch</small>
          </div>
          <span>→</span>
          <div className="store-node">
            <strong>globalThis store</strong>
            <small>flags · log · counter</small>
          </div>
          <span>←</span>
          <div>
            <strong>Client factory</strong>
            <small>fetch · Suspense · cache</small>
          </div>
        </div>
      </section>
      <section className="cards section grid">
        {demos.map(([href, title, copy], index) => (
          <Link className="card demo-link" href={href} key={href}>
            <span className="eyebrow">0{index + 1}</span>
            <h2>{title} →</h2>
            <p className="muted">{copy}</p>
          </Link>
        ))}
      </section>
      <section className="card section">
        <h2>Try this first</h2>
        <ol className="lede">
          <li>Switch to Bob in the header.</li>
          <li>
            Open Admin and flip <code>new-dashboard</code> for Bob.
          </li>
          <li>
            Compare Server (immediate) with Client (cached), then invalidate the client identity.
          </li>
        </ol>
      </section>
    </main>
  )
}
