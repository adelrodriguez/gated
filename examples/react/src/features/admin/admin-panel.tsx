import type { FlagConfig } from "#shared/demo-provider/model"
import {
  resetDemo,
  updateFlaky,
  updateGlobal,
  updateOverride,
} from "#features/admin/server/functions"
import {
  BOOLEAN_KEYS,
  CHECKOUT_VARIANTS,
  FLAG_KEYS,
  PRICING_VARIANTS,
  USERS,
  type FlagKey,
} from "#shared/flags"

function valuesFor(key: FlagKey): readonly string[] {
  if (BOOLEAN_KEYS.some((candidate) => candidate === key)) return ["true", "false"]
  return key === "checkout-theme" ? CHECKOUT_VARIANTS : PRICING_VARIANTS
}

export function AdminPanel({ flags }: { flags: Record<FlagKey, FlagConfig> }) {
  return (
    <div className="stack section">
      {FLAG_KEYS.map((key) => {
        const flag = flags[key]
        return (
          <section className="card" key={key}>
            <div className="row">
              <h2>{key}</h2>
              <span className="pill">{flag.kind}</span>
            </div>
            <form action={updateGlobal} className="row">
              <input name="key" type="hidden" value={key} />
              <div className="field">
                <label htmlFor={`${key}-global`}>Global value</label>
                <select id={`${key}-global`} name="value" defaultValue={String(flag.value)}>
                  {valuesFor(key).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
              <button className="button" type="submit">
                Set global
              </button>
            </form>
            <div className="cards section grid">
              {USERS.map((user) => (
                <form action={updateOverride} className="row" key={user}>
                  <input name="key" type="hidden" value={key} />
                  <input name="user" type="hidden" value={user} />
                  <div className="field">
                    <label htmlFor={`${key}-${user}`}>{user} override</label>
                    <select
                      id={`${key}-${user}`}
                      name="value"
                      defaultValue={String(flag.overrides[user] ?? "inherit")}
                    >
                      <option value="inherit">inherit global</option>
                      {valuesFor(key).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                  <button className="button secondary" type="submit">
                    Apply
                  </button>
                </form>
              ))}
            </div>
            {key === "flaky-flag" ? (
              <form action={updateFlaky} className="row section">
                <div className="field">
                  <label htmlFor="latency">Latency (ms)</label>
                  <input
                    id="latency"
                    min="0"
                    max="10000"
                    name="latencyMs"
                    type="number"
                    defaultValue={flag.latencyMs}
                  />
                </div>
                <label className="pill">
                  <input name="fail" type="checkbox" defaultChecked={flag.fail} /> Throw on decide
                </label>
                <button className="button" type="submit">
                  Set simulation
                </button>
              </form>
            ) : null}
          </section>
        )
      })}
      <form action={resetDemo}>
        <button className="button" type="submit">
          Reset all demo state
        </button>
      </form>
    </div>
  )
}
