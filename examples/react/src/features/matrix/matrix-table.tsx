import { CodeBlock } from "#features/shell/code-block"
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
const matrixKeys = ["new-dashboard", "beta-banner", "checkout-theme", "pricing-experiment"] as const

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
    <section className="experiment matrix-experiment">
      <div className="experiment-copy">
        <div className="row">
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
                    <td className="value" key={matrixKeys[index]}>
                      {String(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CodeBlock label="One batch per identity">{`const rows = await Promise.all(
  users.map(async (distinctId) => {
    const batch = await gate.batch(gates, {
      identity: { distinctId },
    })

    return gates.map((gate) => batch.get(gate))
  })
)`}</CodeBlock>
    </section>
  )
}
