"use client"

import { useActionState, useState } from "react"
import {
  runCache,
  runDedupe,
  runTimeout,
  type DemoResult,
} from "#features/advanced/server/functions"
import { useSelectedUser } from "#features/shell/users-provider"
import { clientFlakyFlag } from "#shared/gates/client"

function ActionCard({
  title,
  copy,
  action,
}: {
  title: string
  copy: string
  action: (previous: DemoResult | null) => Promise<DemoResult>
}) {
  const [state, submit, pending] = useActionState(action, null)
  return (
    <article className="card">
      <h2>{title}</h2>
      <p className="muted">{copy}</p>
      <form action={submit}>
        <button className="button" disabled={pending} type="submit">
          {pending ? "Running…" : `Run ${title.toLowerCase()}`}
        </button>
      </form>
      {state ? (
        <div className="section">
          <strong>{state.summary}</strong>
          <p className="muted mono">{state.detail}</p>
        </div>
      ) : null}
    </article>
  )
}

function AbortCard() {
  const selected = useSelectedUser()
  const identity = { distinctId: selected === "anonymous" ? ("alice" as const) : selected }
  const [result, setResult] = useState("Not run yet")
  async function run() {
    await fetch("/api/simulation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latencyMs: 2000, fail: false }),
    })
    const controller = new AbortController()
    const evaluation = clientFlakyFlag.details({ identity, signal: controller.signal })
    setTimeout(() => controller.abort(new DOMException("Demo cancelled", "AbortError")), 75)
    try {
      const details = await evaluation
      setResult(
        `${details.source}: ${details.error?.name ?? "no error"} · value=${String(details.value)}`
      )
    } catch (error) {
      setResult(
        `${error instanceof Error ? error.name : "Error"}: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      await fetch("/api/simulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latencyMs: 0, fail: false }),
      })
    }
  }
  return (
    <article className="card">
      <h2>AbortController</h2>
      <p className="muted">
        The core evaluator accepts a signal. React hooks intentionally do not.
      </p>
      <button className="button" onClick={run} type="button">
        Start and cancel
      </button>
      <p className="mono">{result}</p>
    </article>
  )
}

export function ActionDemos() {
  return (
    <div className="cards grid">
      <ActionCard
        title="Dedupe"
        copy="Five concurrent evaluations share one in-flight provider decision."
        action={runDedupe}
      />
      <ActionCard
        title="Server cache"
        copy="The first evaluation misses; the second resolves from cache without a provider call."
        action={runCache}
      />
      <ActionCard
        title="Timeout"
        copy="A 1500ms decision crosses the factory’s 1000ms timeout and falls back."
        action={runTimeout}
      />
      <AbortCard />
    </div>
  )
}
