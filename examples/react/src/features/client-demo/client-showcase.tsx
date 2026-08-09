"use client"

import { FeatureGate } from "gated/react"
import { Suspense, useState, useTransition } from "react"
import { useSelectedUser } from "#features/shell/users-provider"
import {
  getClientFetches,
  useAudienceLabel,
  useBetaBanner,
  useCheckoutTheme,
  useNewDashboard,
} from "#shared/gates/client"

type Identity = { distinctId: "alice" | "bob" | "carol" }

function Values({ identity }: { identity: Identity }) {
  const dashboard = useNewDashboard(identity)
  const theme = useCheckoutTheme(identity)
  const custom = useAudienceLabel(identity, "dashboard")
  return (
    <div className="stack">
      <span className="pill">client decision fetches: {getClientFetches()}</span>
      <div className="cards grid">
        <article className="card">
          <p className="muted">useNewDashboard(identity)</p>
          <p className="metric value">{String(dashboard)}</p>
        </article>
        <article className="card">
          <p className="muted">useCheckoutTheme(identity)</p>
          <p className="metric value">{theme}</p>
        </article>
        <article className="card">
          <p className="muted">custom async + cacheKey</p>
          <p className="metric value">{custom}</p>
        </article>
      </div>
    </div>
  )
}

export function ClientShowcase() {
  const selected = useSelectedUser()
  const identity: Identity = { distinctId: selected === "anonymous" ? "alice" : selected }
  const [revision, setRevision] = useState(0)
  const [pending, startTransition] = useTransition()
  const refresh = () => startTransition(() => setRevision((value) => value + 1))
  const invalidate = () => {
    useNewDashboard.invalidate(identity)
    useCheckoutTheme.invalidate(identity)
    useAudienceLabel.invalidate(identity, "dashboard")
    refresh()
  }
  const clear = () => {
    useNewDashboard.clear()
    useBetaBanner.clear()
    useCheckoutTheme.clear()
    useAudienceLabel.clear()
    refresh()
  }
  return (
    <div className="stack" key={revision}>
      <div className="row">
        <span className="pill">bare identity: {identity.distinctId}</span>
        <button className="button" onClick={invalidate} type="button">
          Invalidate this identity
        </button>
        <button className="button secondary" onClick={clear} type="button">
          Clear all React caches
        </button>
        {pending ? <span className="muted">Refreshing…</span> : null}
      </div>
      <Suspense fallback={<div className="card">Suspended while evaluating…</div>}>
        <Values identity={identity} />
      </Suspense>
      <div className="cards grid">
        <article className="card">
          <h2>Boolean FeatureGate</h2>
          <FeatureGate
            gate={useBetaBanner}
            identity={identity}
            loading={<p>Loading banner gate…</p>}
            fallback={<p className="muted">Banner is off.</p>}
          >
            <p className="success">Beta banner is on.</p>
          </FeatureGate>
        </article>
        <article className="card">
          <h2>Variant FeatureGate</h2>
          <FeatureGate
            gate={useCheckoutTheme}
            identity={identity}
            match="dark"
            loading={<p>Loading theme gate…</p>}
            fallback={<p className="muted">Theme does not match dark.</p>}
          >
            <p className="success">Dark checkout matched.</p>
          </FeatureGate>
        </article>
      </div>
    </div>
  )
}
