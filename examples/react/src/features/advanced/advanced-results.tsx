import { ActionDemos } from "#features/advanced/action-demos"
import {
  clearAdvancedCache,
  clearAdvancedTelemetry,
  generateAdvancedEvidence,
} from "#features/advanced/server/functions"
import { getLog, getProviderCalls } from "#shared/demo-provider/store"
import { anonymousDashboard, hookErrorGate, malformedGate } from "#shared/gates/server"
import { getIdentity } from "#shared/server/user"

export async function AdvancedResults() {
  const identity = await getIdentity()
  const options = identity ? { identity } : undefined
  const [anonymous, malformed, hookSuccess] = await Promise.all([
    anonymousDashboard.details(options),
    malformedGate.details(options),
    hookErrorGate.details(options),
  ])
  const log = getLog().slice(0, 80)
  return (
    <div className="stack section">
      <ActionDemos />
      <div className="cards grid">
        <article className="card">
          <h2>Anonymous evaluation</h2>
          <p className="metric value">{String(anonymous.value)}</p>
          <p className="muted">
            identity: {identity?.distinctId ?? "null"} · source: {anonymous.source}
          </p>
          <p>
            With <code>anonymous: "allow"</code>, null reaches the provider and hooks. Cache and
            dedupe recipes bypass null identities.
          </p>
        </article>
        <article className="card">
          <h2>Typed failure</h2>
          <p className="metric danger">{malformed.error?.name ?? "none"}</p>
          <p className="muted">
            Malformed provider output falls back to {String(malformed.value)} from{" "}
            {malformed.source}.
          </p>
        </article>
        <article className="card">
          <h2>Hook error isolation</h2>
          <p className="metric success">{String(hookSuccess.value)}</p>
          <p className="muted">
            A before hook throws, <code>onHookError</code> records it, and the provider evaluation
            still succeeds.
          </p>
        </article>
        <article className="card">
          <h2>Provider calls</h2>
          <p className="metric value">{getProviderCalls()}</p>
          <p className="muted">Shared counter across RSC, route handlers, decide and decideMany.</p>
          <form action={clearAdvancedCache}>
            <button className="button secondary" type="submit">
              Clear server cache
            </button>
          </form>
        </article>
      </div>
      <section className="card">
        <div className="row">
          <div>
            <p className="eyebrow">defineHook lifecycle</p>
            <h2 className="section-title">Event log</h2>
          </div>
          <form action={generateAdvancedEvidence}>
            <button className="button" type="submit">
              Refresh + generate evidence
            </button>
          </form>
          <form action={clearAdvancedTelemetry}>
            <button className="button secondary" type="submit">
              Clear log + counter
            </button>
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Phase</th>
                <th>Flag</th>
                <th>Identity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.timestamp.slice(11, 23)}</td>
                  <td>
                    <span className="phase">{entry.phase}</span>
                  </td>
                  <td>{entry.flagKey}</td>
                  <td>{entry.distinctId ?? "null"}</td>
                  <td className="muted">{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
