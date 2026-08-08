# 06 — Enrich HookContext

Delivers: API opportunity #2. Depends on: 03 (evaluation record supplies the data). Breaking (removes the unused `TOptions` generic).

## Goal

Hooks can see what they're evaluating: gate kind, default, allowed variants. A cache hook can refuse to serve a boolean decision to a variant gate instead of poisoning the flow.

## Problem

`HookContext` (src/lib/types.ts:17-23) carries only `flagKey` and `identity`, plus a `TOptions` generic that core never populates — dead generality.

## Changes

- `src/lib/types.ts`:

  ```ts
  export type HookContext<TIdentity extends Identity = Identity> = {
    readonly flagKey: string
    readonly identity: TIdentity | null
    readonly kind: "boolean" | "variant"
    readonly defaultValue: boolean | string
    readonly variants?: readonly string[]
  }
  ```

  Drop the `TOptions` type parameter entirely (breaking for anyone who instantiated it — almost certainly nobody, but changeset must say so).

- `src/lib/index.ts` — build the context from the evaluation record (plan 03); `kind` mirrors the existing `expectedType` derivation (lib/index.ts:140).
- `src/hooks/recipes.ts` — `cacheHook.resolve`: discard/ignore a cached decision whose shape doesn't match `context.kind` (return `undefined` so the provider is consulted and the cache overwritten) instead of returning it to fail validation downstream.
- README hook docs: document the new context fields.

## Tests

- Lifecycle suite: hooks receive `kind`, `defaultValue`, `variants` for both boolean and variant gates.
- cacheHook: stale boolean decision cached under a key now evaluated as a variant gate → cache miss behavior, provider consulted, cache overwritten with the valid decision (self-healing; complements the H4 fix which prevents new poisoning).
- Compile-time: `HookContext` no longer accepts a second type argument (`@ts-expect-error` test).

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "HookContext now includes `kind`, `defaultValue`, and `variants`; the unused `TOptions` type parameter was removed. `cacheHook` self-heals type-mismatched cache entries."
