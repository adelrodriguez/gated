# b08 — Fallback observability (`onFallback`)

Fixes: A3. Depends on: —. Additive.

## Goal

One factory-level callback observes every evaluation that fell back to its default, so production telemetry does not require a custom error hook or `details()` at every call site.

## Problem

Fail-soft is the right posture, but it makes degradation invisible: a plain `await flag()` caller cannot tell "flag off" from "provider down", and wiring observability today means either writing an error hook (per-hook knowledge required) or migrating every call site to `details()`. `onHookError` covers hook failures; nothing symmetric covers gate failures.

## Design

```ts
type FallbackReport<TIdentity extends Identity = Identity> = {
  flagKey: string
  identity: TIdentity | null
  defaultValue: boolean | string
  error: Error // IdentityNotFoundError | GateTimeoutError | MalformedDecisionError | ... or abort reason
}

type GatedConfig<TIdentity> = {
  // ...existing
  onFallback?: (report: FallbackReport<TIdentity>) => MaybePromise<void>
}
```

- Invoked exactly once per evaluation that returns its default due to a failure — the same condition that sets `details().source === "default"` with an `error`. Never invoked for a legitimate `false`/default-variant decision from a hook or provider.
- Same delivery contract as `onHookError` (README hook-error policy point 2): fire-and-forget, synchronous throws and asynchronous rejections consumed, never contributes to gate latency. Reuse the `reportHookError` helper shape.
- Relationship to `error` hooks: `error` hooks are per-registration extensions with the full context; `onFallback` is factory-level telemetry with a plain snapshot (not the live context — copy the four fields so late readers cannot observe a reused context). Both fire; they do not replace each other.
- Batch: each falling-back entry reports individually (batch preserves per-flag semantics).

## Changes

- `src/lib/types.ts` — `FallbackReport`, `GatedConfig.onFallback` (and via Omit, the anonymous config).
- `src/lib/index.ts` — report from the failure tail of `executeGateDetails` (where `failure` is set), after error hooks are scheduled; share the consume-everything reporter helper with `onHookError`.
- `src/index.ts` — export `FallbackReport` type.
- README — Evaluation Details section gains an "Observing fallbacks" note; API Reference config table adds `onFallback`.

## Tests

- `src/__tests__/lifecycle.test.ts` — reports once with the correct error class for: identity failure, provider rejection, malformed decision, invalid variant, timeout, caller abort. Not called on: successful provider decision, hook-resolved decision, a provider legitimately returning the default value. Hostile reporter (throws / rejects / never resolves) does not affect the returned value or latency. Batch: two failing entries → two reports.
- Snapshot semantics: mutating the report after delivery does not affect evaluation; report identity matches the evaluation's resolved identity (including `null` in anonymous mode).

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `onFallback` to `buildGate` config: a fire-and-forget reporter invoked whenever an evaluation returns its default because of a failure."
