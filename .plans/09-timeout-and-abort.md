# 09 — Timeout and abort support

Delivers: API opportunity #4. Depends on: 08 (options object carries `signal`). Additive, non-breaking.

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

- Timeout covers the full evaluation (identify + hooks + decide), implemented in `executeGate` as a race against `AbortSignal.timeout(ms)`; combine with a caller `signal` via `AbortSignal.any`.
- On timeout/abort: treat as a gate error — error hooks fire with a `GateTimeoutError` / the abort reason, default value returned, `details()` shows `source: "default"` with the error. Finally hooks still run.
- Pass the combined signal to the provider: `decide(key, identity, { signal })` — additive third parameter so providers can cancel in-flight fetches. Also add `signal` to `HookContext` so hooks can cancel their own work.
- No default timeout (opt-in only) — do not change behavior for existing consumers.

## Changes

- `src/lib/types.ts` — `timeoutMs?` on `GatedConfig` and on gate options; `signal?: AbortSignal` in `GateCallOptions`; `decide` gains optional `{ signal }` param; export `GateTimeoutError`.
- `src/lib/index.ts` — signal plumbing in `executeGate`; ensure losing branches of the race don't produce unhandled rejections (attach a noop catch to the abandoned promise).
- README — "Timeouts and cancellation" section.

## Tests

- Provider that never resolves + `timeoutMs: 50` → default returned promptly; error hooks received `GateTimeoutError`; finally hooks ran.
- Per-gate `timeoutMs` overrides factory-level.
- Caller abort mid-flight → default + abort reason in error hooks.
- `decide` receives a signal that is aborted after timeout (spy asserts `signal.aborted`).
- No timeout configured → no signal-related behavior change; no unhandled rejection warnings in the run (assert via process listener in test).

## Verification

- `bun test`, `bun run build`, `bun run check`
- Confirm `AbortSignal.any`/`AbortSignal.timeout` availability against the build target (browser, Node 20+); polyfill or hand-roll combination if the support matrix requires it.

## Release

- Changeset: minor. "Add `timeoutMs` (factory and per-gate) and `signal` support; timed-out evaluations fall back to the default value and are reported to error hooks."
