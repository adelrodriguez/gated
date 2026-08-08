# 09 — Timeout and abort support

Delivers: API opportunity #4. Depends on: 03, 04, 06, 07, 08. Mostly additive; requiring `HookContext.signal` breaks consumers that construct hook contexts.

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

- Timeout covers the complete lifecycle (identify + before/resolve/after/error/finally hooks + decide). Combine the timeout and caller signal with an `AbortController` and removable listeners, then guard each awaited stage inside one pipeline and check for cancellation before starting the next stage. Do not race a complete evaluation pipeline against a second timeout/fallback pipeline.
- On timeout/abort: transition the single evaluation record to its error path exactly once — invoke error hooks with a `GateTimeoutError` / the abort reason, return the default value, record `source: "default"` with the error in `details()`, and invoke finally hooks exactly once.
- The caller's deadline is a hard latency bound. After cancellation, error/finally handlers are invoked once with the aborted signal, but asynchronous cleanup is consumed safely rather than allowed to delay the result beyond the deadline. Tests distinguish handler invocation from asynchronous cleanup completion.
- A completed decision remains authoritative if only `finally` teardown exceeds the deadline. If an error hook exceeds the deadline, preserve the original evaluation failure and dispatch finally hooks without waiting forever for error cleanup.
- A provider or hook that ignores the signal may continue its own already-started work, but the evaluation pipeline must never start another lifecycle stage after cancellation.
- Pass the combined signal to the provider: `decide(key, identity, { signal })` — additive third parameter so providers can cancel in-flight fetches. Also add `signal` to `HookContext` so hooks can cancel their own work.
- React gates use factory/per-gate timeouts. `createReactGate` does not accept caller signals because its evaluations may be shared across components; React cache identity remains the serialized evaluation identity from plan 05's `cacheKey` projection.
- No default timeout (opt-in only) — do not change behavior for existing consumers.
- Validate configured timeouts as positive finite host-timer delays no greater than 2,147,483,647 milliseconds.

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
- A hung error or finally hook cannot extend the hard deadline.
- No timeout configured → no signal-related behavior change; no unhandled rejection warnings in the run (assert via process listener in test).
- Combined evaluations detach their caller abort listener during cleanup.

## Verification

- `bun test`, `bun run build`, `bun run check`
- Confirm `AbortController` availability against the build target.

## Release

- Changeset: minor. "Add `timeoutMs` (factory and per-gate) and `signal` support; timed-out evaluations fall back to the default value and are reported to error hooks."
