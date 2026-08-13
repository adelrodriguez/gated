"use client"

import { FeatureGate, useGate, useGateCache } from "gated/react"
import { Suspense, useState, useTransition } from "react"
import { CodeBlock } from "#features/shell/code-block"
import { useSelectedUser } from "#features/shell/users-provider"
import {
  getClientFetches,
  clientBetaBanner,
  clientCheckoutTheme,
  clientNewDashboard,
  useAudienceLabel,
} from "#shared/gates/client"

type Identity = { distinctId: "alice" | "bob" | "carol" }

function Values({ identity }: { identity: Identity }) {
  const dashboard = useGate(clientNewDashboard, { identity })
  const theme = useGate(clientCheckoutTheme, { identity })
  const custom = useAudienceLabel(identity, "dashboard")
  return (
    <div className="stack">
      <div className="signal-grid four-signals">
        <article className="signal">
          <p>useNewDashboard</p>
          <p className="metric value">{String(dashboard)}</p>
        </article>
        <article className="signal">
          <p>useCheckoutTheme</p>
          <p className="metric value">{theme}</p>
        </article>
        <article className="signal">
          <p>custom key</p>
          <p className="metric value">{custom}</p>
        </article>
        <article className="signal">
          <p>client fetches</p>
          <p className="metric value">{getClientFetches()}</p>
        </article>
      </div>
    </div>
  )
}

export function ClientShowcase() {
  const selected = useSelectedUser()
  const cache = useGateCache()
  const identity: Identity = { distinctId: selected === "anonymous" ? "alice" : selected }
  const [revision, setRevision] = useState(0)
  const [pending, startTransition] = useTransition()
  const refresh = () => startTransition(() => setRevision((value) => value + 1))
  const invalidate = () => {
    cache.invalidate(clientNewDashboard, identity)
    cache.invalidate(clientCheckoutTheme, identity)
    cache.invalidateKey([identity.distinctId, "dashboard"])
    refresh()
  }
  const clear = () => {
    cache.clear()
    refresh()
  }
  return (
    <div className="showcase-stack" key={revision}>
      <section className="control-bar" aria-label="React cache controls">
        <div className="context-readout">
          <span>Identity</span>
          <strong>{identity.distinctId}</strong>
        </div>
        <div className="control-actions">
          <button className="button" onClick={invalidate} type="button">
            Invalidate this identity
          </button>
          <button className="button secondary" onClick={clear} type="button">
            Clear all React caches
          </button>
          {pending ? <span className="muted">Refreshing…</span> : null}
        </div>
      </section>

      <section className="experiment">
        <div className="experiment-copy">
          <p className="eyebrow">Suspense reads</p>
          <h2>Read typed values with hooks</h2>
          <Suspense fallback={<div className="loading-panel">Evaluating client gates…</div>}>
            <Values identity={identity} />
          </Suspense>
        </div>
        <CodeBlock label="React hook reads">{`const dashboard = useNewDashboard(identity)
const theme = useCheckoutTheme(identity)

const label = useAudienceLabel(identity, "dashboard")`}</CodeBlock>
      </section>

      <section className="experiment">
        <div className="experiment-copy">
          <p className="eyebrow">FeatureGate</p>
          <h2>Render boolean and variant branches</h2>
          <div className="branch-grid">
            <article className="branch-result">
              <span>Boolean gate</span>
              <FeatureGate
                gate={clientBetaBanner}
                identity={identity}
                loading={<p>Loading banner gate…</p>}
                fallback={<p className="muted">Fallback rendered: banner is off.</p>}
              >
                <p className="success">Children rendered: banner is on.</p>
              </FeatureGate>
            </article>
            <article className="branch-result">
              <span>Variant match: dark</span>
              <FeatureGate
                gate={clientCheckoutTheme}
                identity={identity}
                match="dark"
                loading={<p>Loading theme gate…</p>}
                fallback={<p className="muted">Fallback rendered: not dark.</p>}
              >
                <p className="success">Children rendered: dark matched.</p>
              </FeatureGate>
            </article>
          </div>
        </div>
        <CodeBlock label="Conditional rendering">{`<FeatureGate
  gate={clientBetaBanner}
  identity={identity}
  fallback={<BannerOff />}
>
  <BetaBanner />
</FeatureGate>

<FeatureGate gate={clientCheckoutTheme} identity={identity} match="dark">
  <DarkCheckout />
</FeatureGate>`}</CodeBlock>
      </section>
    </div>
  )
}
