import { getProviderCalls } from "#shared/demo-provider/store"
import { USERS } from "#shared/flags"
import {
  betaBanner,
  checkoutTheme,
  gate,
  newDashboard,
  pricingExperiment,
} from "#shared/gates/server"

const matrixGates = [newDashboard, betaBanner, checkoutTheme, pricingExperiment] as const

export async function MatrixTable() {
  const before = getProviderCalls()
  const rows = await Promise.all(
    USERS.map(async (user) => {
      const batch = await gate.batch(matrixGates, { identity: { distinctId: user } })
      return { user, values: matrixGates.map((item) => batch.get(item)) }
    })
  )
  const calls = getProviderCalls() - before
  return (
    <section className="card">
      <div className="row">
        <span className="pill">identity override</span>
        <span className="pill">{calls} decideMany calls</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>new-dashboard</th>
              <th>beta-banner</th>
              <th>checkout-theme</th>
              <th>pricing-experiment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user}>
                <th>{row.user}</th>
                {row.values.map((value, index) => (
                  <td className="value" key={matrixGates[index] === undefined ? index : index}>
                    {String(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Each row is one <code>gate.batch(flags, &#123; identity &#125;)</code>. The explicit call
        option overrides the cookie identity.
      </p>
    </section>
  )
}
