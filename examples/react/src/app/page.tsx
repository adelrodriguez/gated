import Link from "next/link"
import { CodeBlock } from "#features/shell/code-block"

export const dynamic = "force-dynamic"

const demos = [
  ["/admin", "Provider state", "overrides · latency · failure"],
  ["/server", "Server evaluation", "details() · batch() · decideMany"],
  ["/client", "React integration", "createReactGate · FeatureGate"],
  ["/matrix", "Identity matrix", "identity override · batch()"],
  ["/advanced", "Evaluation lifecycle", "hooks · recipes · cancellation"],
] as const

export default function OverviewPage() {
  return (
    <main className="shell page">
      <header className="showcase-intro">
        <p className="eyebrow">gated/react technical demo</p>
        <h1 className="title">The full API, running live</h1>
      </header>

      <section className="overview-grid" aria-label="Technical demos">
        <div className="demo-list">
          {demos.map(([href, title, meta]) => (
            <Link className="card demo-link" href={href} key={href}>
              <h2>{title}</h2>
              <p className="demo-meta">{meta}</p>
              <span className="link-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
        <CodeBlock label="The factory behind every demo">{`const gate = buildGate({
  identify: getIdentity,
  ...demoProvider,
  hooks: [loggingHook, dedupeHook()],
  onHookError,
  timeoutMs: 1000,
})

const checkoutTheme = gate({
  key: "checkout-theme",
  defaultValue: "system",
  variants: ["light", "dark", "system"],
})

await checkoutTheme()
// "light" | "dark" | "system"`}</CodeBlock>
      </section>
    </main>
  )
}
