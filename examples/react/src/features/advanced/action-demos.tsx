"use client"

import { useActionState, useRef, useState } from "react"
import {
  runCache,
  runDedupe,
  runTimeout,
  type DemoResult,
} from "#features/advanced/server/functions"
import { CodeBlock } from "#features/shell/code-block"
import { useSelectedUser } from "#features/shell/users-provider"
import { clientFlakyFlag } from "#shared/gates/client"

function ActionCard({
  title,
  copy,
  snippet,
  action,
}: {
  title: string
  copy: string
  snippet: string
  action: (previous: DemoResult | null) => Promise<DemoResult>
}) {
  const [state, submit, pending] = useActionState(action, null)
  return (
    <article className="experiment">
      <div className="experiment-copy">
        <p className="eyebrow">Runnable test</p>
        <h2>{title}</h2>
        <p className="muted">{copy}</p>
        <form action={submit}>
          <button className="button" disabled={pending} type="submit">
            {pending ? "Running…" : `Run ${title.toLowerCase()}`}
          </button>
        </form>
        <div className="test-output" aria-live="polite">
          {state ? (
            <>
              <strong>{state.summary}</strong>
              <p className="muted mono">{state.detail}</p>
            </>
          ) : (
            <span className="muted">No result yet.</span>
          )}
        </div>
      </div>
      <CodeBlock label={`${title} implementation`}>{snippet}</CodeBlock>
    </article>
  )
}

function AbortCard() {
  const selected = useSelectedUser()
  const identity = { distinctId: selected === "anonymous" ? ("alice" as const) : selected }
  const [result, setResult] = useState("Not run yet")
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  async function run() {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    try {
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
      }
    } catch (error) {
      setResult(`Setup failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await fetch("/api/simulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latencyMs: 0, fail: false }),
      }).catch(() => undefined)
      runningRef.current = false
      setRunning(false)
    }
  }
  return (
    <article className="experiment">
      <div className="experiment-copy">
        <p className="eyebrow">Runnable test</p>
        <h2>AbortController</h2>
        <p className="muted">The core evaluator accepts a signal. React hooks do not.</p>
        <button className="button" disabled={running} onClick={run} type="button">
          {running ? "Cancelling…" : "Start and cancel"}
        </button>
        <div className="test-output mono" aria-live="polite">
          {result}
        </div>
      </div>
      <CodeBlock label="Cancellation implementation">{`const controller = new AbortController()
const evaluation = flakyFlag.details({
  identity,
  signal: controller.signal,
})

controller.abort()
const details = await evaluation`}</CodeBlock>
    </article>
  )
}

export function ActionDemos() {
  return (
    <div className="showcase-stack">
      <ActionCard
        title="Dedupe"
        copy="Five concurrent evaluations share one in-flight provider decision."
        action={runDedupe}
        snippet={`const values = await Promise.all(
  Array.from({ length: 5 }, () => newDashboard({ identity }))
)

// Factory coalescing collapses these into one provider call`}
      />
      <ActionCard
        title="Server cache"
        copy="The first evaluation misses; the second resolves from cache without a provider call."
        action={runCache}
        snippet={`const cachedGate = buildGate({
  cache,
  coalesce: true,
  // ...provider config
})

await cachedDashboard.details({ identity }) // miss
await cachedDashboard.details({ identity }) // hit`}
      />
      <ActionCard
        title="Timeout"
        copy="A 1500ms decision crosses the factory’s 1000ms timeout and falls back."
        action={runTimeout}
        snippet={`const factory = buildGate({
  timeoutMs: 1000,
  // ...provider config
})

const result = await flakyFlag.details({ identity })
// result.source === "default"`}
      />
      <AbortCard />
    </div>
  )
}
