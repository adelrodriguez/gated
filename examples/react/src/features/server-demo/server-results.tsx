import type { EvaluationDetails } from "gated"
import { CodeBlock } from "#features/shell/code-block"
import { getProviderCalls } from "#shared/demo-provider/store"
import {
  allMainGates,
  betaBanner,
  checkoutTheme,
  flakyFlag,
  gate,
  newDashboard,
  pricingExperiment,
} from "#shared/gates/server"
import { getIdentity, getSelectedUser } from "#shared/server/user"

function DetailsCard({
  title,
  details,
}: {
  title: string
  details: EvaluationDetails<boolean | string>
}) {
  return (
    <article className="details-card">
      <div className="row">
        <h2>{title}</h2>
        <span className="pill">{typeof details.value}</span>
      </div>
      <p className="metric value">{String(details.value)}</p>
      <dl>
        <dt className="muted">source</dt>
        <dd>{details.source}</dd>
        {details.payload === undefined ? null : (
          <>
            <dt className="muted">payload</dt>
            <dd>
              <code>{JSON.stringify(details.payload)}</code>
            </dd>
          </>
        )}
        {details.error ? (
          <>
            <dt className="muted">error</dt>
            <dd className="danger">
              {details.error.name}: {details.error.message}
            </dd>
          </>
        ) : null}
      </dl>
    </article>
  )
}

export async function ServerResults() {
  const [user, identity] = await Promise.all([getSelectedUser(), getIdentity()])
  const options = identity ? { identity } : undefined
  const [dashboard, banner, theme, pricing, flaky] = await Promise.all([
    newDashboard.details(options),
    betaBanner.details(options),
    checkoutTheme.details(options),
    pricingExperiment.details(options),
    flakyFlag.details(options),
  ])
  const before = getProviderCalls()
  const batch = await gate.batch(allMainGates, options)
  const after = getProviderCalls()
  const batchTheme = batch.details(checkoutTheme)

  return (
    <div className="showcase-stack">
      <section className="control-bar" aria-label="Evaluation context">
        <div className="context-readout">
          <span>Resolved identity</span>
          <strong>{identity?.distinctId ?? "null"}</strong>
        </div>
        <div className="context-readout">
          <span>Selected identity</span>
          <strong>{user}</strong>
        </div>
      </section>
      <section className="experiment">
        <div className="experiment-copy">
          <p className="eyebrow">Evaluation details</p>
          <h2>Value, source, payload, and fallback error</h2>
          <div className="details-grid">
            <DetailsCard title="new-dashboard" details={dashboard} />
            <DetailsCard title="beta-banner" details={banner} />
            <DetailsCard title="checkout-theme" details={theme} />
            <DetailsCard title="pricing-experiment" details={pricing} />
            <DetailsCard title="flaky-flag" details={flaky} />
          </div>
        </div>
        <CodeBlock label="Server component evaluation">{`const details = await checkoutTheme.details({ identity })

details.value   // typed gate value
details.source  // "cache" | "provider" | "default"
details.payload // optional variant payload
details.error   // fallback error, when present`}</CodeBlock>
      </section>
      <section className="experiment">
        <div className="experiment-copy">
          <p className="eyebrow">batch() + decideMany</p>
          <h2>
            5 evaluations → {after - before} provider call{after - before === 1 ? "" : "s"}
          </h2>
          <div className="row">
            <span className="pill">
              provider calls {before} → {after}
            </span>
          </div>
          <pre className="result-json">
            {JSON.stringify(
              { checkoutTheme: batch.get(checkoutTheme), details: batchTheme },
              null,
              2
            )}
          </pre>
        </div>
        <CodeBlock label="Provider-level batch">{`const batch = await gate.batch(allMainGates, { identity })

const theme = batch.get(checkoutTheme)
const details = batch.details(checkoutTheme)`}</CodeBlock>
      </section>
    </div>
  )
}
