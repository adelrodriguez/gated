# 02 — Unify config types, accept sync functions

Fixes: H9. No dependencies. Non-breaking (widens accepted types).

## Goal

One source of truth for the gate configuration type. Sync `identify`/`decide` functions type-check, matching what the runtime already supports.

## Problem

- `GatedConfig` (src/lib/types.ts:33-37) requires `Promise`-returning `identify`/`decide`.
- `executeGate` (src/lib/index.ts:123-128) re-declares a wider inline config accepting sync returns.
- Runtime helpers (`identify` at lib/index.ts:3, `evaluateDecision` at lib/index.ts:39) already accept `T | Promise<T>`.

## Changes

- `src/lib/types.ts` — introduce `type MaybePromise<T> = T | Promise<T>` and widen `GatedConfig`:

  ```ts
  export type GatedConfig<TIdentity extends Identity = Identity> = {
    identify: () => MaybePromise<TIdentity | null>
    decide: (key: string, identity: TIdentity) => MaybePromise<Decision>
    hooks?: Array<Hook<TIdentity>>
  }
  ```

- `src/lib/index.ts` — delete the inline config type on `executeGate`; use `GatedConfig<TIdentity>` directly.
- Sweep for other inline duplicates of the config shape (none expected beyond `executeGate`).

## Tests

- `src/__tests__/core.test.ts` — add cases building a gate with fully synchronous `identify` and `decide` (no `Promise.resolve` wrappers), asserting evaluation works and types compile without casts.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: patch (or minor). "`GatedConfig` now accepts synchronous `identify` and `decide` functions, matching runtime behavior."
