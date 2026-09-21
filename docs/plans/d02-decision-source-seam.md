# d02 — Finish the decision-source seam

Status: ready. From the 2026-08-10 architecture review (revised 2026-08-14 — #83/#84 already removed the `onPrepared` protocol, which was most of the original candidate; this plan finishes the seam). Depends on: d01. Behavioral change: none; batch and coalescing semantics are pinned by existing tests.

## Goal

The engine evaluates one gate against a total decision-source adapter. The deadline is an explicit parameter, the `identityResult` in-band checks disappear, and `IdentityResult` stops being an engine export.

## Problem

What remains after #83/#84 collapsed `onPrepared`:

- **The undocumented timeout rule.** When `execution` is present the engine silently disables its own timeout (engine.ts:109, `execution ? undefined : (options.timeoutMs ?? config.timeoutMs)`) and trusts that batch pre-baked per-entry deadlines into the signal (batch.ts:45-55, 110). The `ExecutionOverrides` docblock (engine.ts:37-42) does not state this. A second orchestrated caller that forgot it would run gates with no deadline.
- **In-band identity dispatch.** The engine re-implements "use the pre-resolved identity" with two shape checks inside its own identity closure (engine.ts:127-133) instead of the caller supplying a resolver. `IdentityResult` (engine.ts:33-35) is an identity concept exported from the engine; batch imports the type from engine and the function from identity.
- **Duplicated plumbing.** Identity resolution and error normalization exist in both paths (engine.ts:126-134 vs batch.ts:59-66); the timeout expression `options.timeoutMs ?? config.timeoutMs` appears twice in batch.ts (:45, :55).

## Design

`ExecutionOverrides` becomes a total adapter, and the deadline becomes explicit:

```ts
export type DecisionSource<TIdentity extends Identity> = {
  resolveIdentity(override: TIdentity | null | undefined): Promise<TIdentity | null>
  fetchDecision(flagKey: string, identity: TIdentity | null, signal: AbortSignal): Promise<Decision>
}

type EvaluationDeadline = { timeoutMs: number | undefined } | { signal: AbortSignal }
```

- **Direct adapter** — built once per factory from d01's `ResolvedConfig`: `resolveIdentity` and `fetchDecision` are the resolved functions themselves.
- **Batch adapter** — built per `batch()` call: `resolveIdentity` returns or rethrows the one pre-resolved identity; `fetchDecision` is the existing enqueue-into-`decideMany` provider closure (batch.ts:111-133).
- `executeGateDetails(config, options, callOptions, source, deadline, state)`: the direct path passes `{ timeoutMs: options.timeoutMs ?? config.timeoutMs }`; batch passes `{ signal: entrySignal }`. No caller can forget the rule because the parameter is total.
- The engine's identity closure (engine.ts:126-134) becomes `source.resolveIdentity(callOptions?.identity)`. `IdentityResult` moves into batch.ts, its only remaining consumer, or dissolves into the adapter closure.

## Changes

- `src/lib/evaluation/engine.ts` — replace `execution?: ExecutionOverrides` with required `source: DecisionSource` and `deadline: EvaluationDeadline`; delete `ExecutionOverrides`, `IdentityResult`, and the in-band identity checks.
- `src/lib/evaluation/batch.ts` — build the batch adapter; the timeout expression computed once.
- `src/factory.ts` — build the direct adapter once next to `resolveConfig` (d01); evaluator closures pass it.
- `src/lib/evaluation/resolve.ts` — unchanged (its `provider` thunk now comes from `source.fetchDecision`).

## Tests

- All existing batch tests (src/**tests**/batch.test.ts) and coalescing/cache tests (lifecycle.test.ts, resolve.test.ts) must pass unchanged — they pin one `decideMany` per flush, per-entry fallback to `decide`, per-entry timeout/abort isolation, and follower error paths.
- New: drive `executeGateDetails` with a hand-built `DecisionSource` — batch-shaped behavior (fetch enqueues, cache hit never fetches) testable without `setTimeout` flushes.
- Deadline regression: an orchestrated caller cannot produce an undeadlined gate — `deadline` is a required parameter, and an entry-signal abort still surfaces as `GateTimeoutError` in details.

## Verification

- `pnpm run test`, `pnpm run build`, `pnpm run check`, `pnpm run analyze`

## Release

- Changeset: none (internal seam restructuring; no public entry point changes shape or behavior).

## Open decisions for the implementer

- Whether `fetchDecision` receives the `HookContext` (resolve.ts derives the evaluation key from it) or the narrower `(flagKey, identity, signal)` — pick whichever keeps `resolveDecision`'s signature stable.
