# 09 — Timeout and abort support

Delivers: API opportunity #4. Depends on: 03, 04, 06, 07, 08. Additive, non-breaking.

## Goal

A slow provider cannot hang a gate. Callers can bound latency and get the default value instead, with the timeout observable via error hooks and `details()`.

## Design

```ts
const gate = buildGate({
  identify,
  decide,
  timeoutMs: 500, // applies to every gate from this factory
})

const flag = gate({ key: "x", defaultValue: false, timeoutMs: 100 }) // per-gate override

await flag({ signal: controller.signal }) // caller-supplied abort
```

- Timeout covers the operational evaluation stages (identify + before/resolve/after hooks + decide). Combine `AbortSignal.timeout(ms)` with a caller signal via `AbortSignal.any`, then guard each awaited stage inside one pipeline and check for cancellation before starting the next stage. Do not race a complete evaluation pipeline against a second timeout/fallback pipeline.
- On timeout/abort: transition the single evaluation record to its error path exactly once — invoke error hooks with a `GateTimeoutError` / the abort reason, return the default value, record `source: "default"` with the error in `details()`, and invoke finally hooks exactly once.
- The caller's deadline is a hard latency bound. After cancellation, error/finally handlers are invoked once with the aborted signal, but asynchronous cleanup is consumed safely rather than allowed to delay the result beyond the deadline. Tests distinguish handler invocation from asynchronous cleanup completion.
- A provider or hook that ignores the signal may continue its own already-started work, but the evaluation pipeline must never start another lifecycle stage after cancellation.
- Pass the combined signal to the provider: `decide(key, identity, { signal })` — additive third parameter so providers can cancel in-flight fetches. Also add `signal` to `HookContext` so hooks can cancel their own work.
- No default timeout (opt-in only) — do not change behavior for existing consumers.

## Changes

- `src/lib/types.ts` — `timeoutMs?` on `GatedConfig` and on gate options; `signal?: AbortSignal` in `GateCallOptions`; `decide` gains optional `{ signal }` param; export `GateTimeoutError`.
- `src/lib/index.ts` — signal plumbing and a reusable `raceWithSignal`/cancellation guard around each awaited operational stage in `executeGate`; use one catch/finally transition and consume the abandoned stage's eventual rejection.
- README — "Timeouts and cancellation" section.

## Tests

- Provider that never resolves + `timeoutMs: 50` → default returned promptly; error hooks received `GateTimeoutError`; finally hooks ran.
- Per-gate `timeoutMs` overrides factory-level.
- Caller abort mid-flight → default + abort reason in error hooks.
- `decide` receives a signal that is aborted after timeout (spy asserts `signal.aborted`).
- A signal-ignoring provider that resolves after timeout cannot trigger validation, after hooks, cache writes, or a second finally pass.
- Timeout during a hook prevents every later lifecycle stage from starting; error/finally handlers are each invoked once without extending the hard deadline.
- No timeout configured → no signal-related behavior change; no unhandled rejection warnings in the run (assert via process listener in test).

## Verification

- `bun test`, `bun run build`, `bun run check`
- Confirm `AbortSignal.any`/`AbortSignal.timeout` availability against the build target (browser, Node 20+); polyfill or hand-roll combination if the support matrix requires it.

## Release

- Changeset: minor. "Add `timeoutMs` (factory and per-gate) and `signal` support; timed-out evaluations fall back to the default value and are reported to error hooks."
