import type { EvaluationDetails } from "gated"
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
    <article className="card">
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
    <>
      <div className="row">
        <span className="pill">identity: {identity?.distinctId ?? "null"}</span>
        <span className="pill">selected: {user}</span>
      </div>
      <div className="cards section grid">
        <DetailsCard title="new-dashboard" details={dashboard} />
        <DetailsCard title="beta-banner" details={banner} />
        <DetailsCard title="checkout-theme" details={theme} />
        <DetailsCard title="pricing-experiment" details={pricing} />
        <DetailsCard title="flaky-flag" details={flaky} />
      </div>
      <section className="card section">
        <p className="eyebrow">gate.batch + decideMany</p>
        <h2 className="section-title">
          5 evaluations → {after - before} provider call{after - before === 1 ? "" : "s"}
        </h2>
        <p className="muted">
          Counter moved from {before} to {after}. The batch resolved identity once and used one
          provider-level round trip.
        </p>
        <pre>
          {JSON.stringify(
            { checkoutTheme: batch.get(checkoutTheme), details: batchTheme },
            null,
            2
          )}
        </pre>
      </section>
    </>
  )
}
