# b01 — Collision-safe, pluggable recipe keys

Fixes: F1, F2 (mechanism + docs), F8 (test). Depends on: —. Behavioral change: persisted cache keys change encoding; old entries orphan and expire naturally.

## Goal

No two distinct (flag, identity) evaluations ever share a cache or dedupe key, and consumers whose targeting depends on identity attributes can opt into keys that reflect them.

## Problem

- `getKey` (src/hooks/recipes.ts:47) concatenates `` `${flagKey}:${distinctId}` `` with a bare `:`. Flag `"a:1"` + id `"2"` and flag `"a"` + id `"1:2"` both produce `"a:1:2"`; `distinctId: 1` and `distinctId: "1"` both produce `"f:1"`. Reproduced: a shared cache served flag `"a"` the decision cached for flag `"a:1"`, and the string-id user received the numeric-id user's decision. The same key feeds `dedupeHook`, so concurrent requests can be wrongly coalesced.
- The key ignores every identity attribute except `distinctId` (F2). Reproduced: overriding `plan: "free" → "pro"` returned the stale cached decision; the provider never saw the new attributes.

## Design

1. Make the default encoding unambiguous and type-preserving:

```ts
function getKey(flagKey: string, distinctId: string | number): string {
  return JSON.stringify([flagKey, typeof distinctId, String(distinctId)])
}
```

`JSON.stringify` of a tuple removes delimiter ambiguity; the `typeof` component separates `1` from `"1"`.

2. Add an optional key projection to both recipes, defaulting to the fixed encoding:

```ts
type RecipeKeyFn = (context: HookContext) => string

cacheHook(cache, options?: { key?: RecipeKeyFn })
dedupeHook(options?: { key?: RecipeKeyFn })
```

The projection receives the full `HookContext` (flagKey, identity, kind, variants), so an attribute-sensitive consumer can write `key: (ctx) => JSON.stringify([ctx.flagKey, ctx.identity?.distinctId, ctx.identity?.plan])`. Anonymous bypass (`!context.identity`) stays in the recipes and is not delegated to the projection.

3. Document the F2 default explicitly in README (cache/dedupe sections): keys are per `distinctId` by default; identity attributes are not part of the key; use the `key` option when targeting rules depend on attributes; prefer short TTLs or explicit invalidation when attributes change mid-session.

## Changes

- `src/hooks/recipes.ts` — new `getKey` encoding; `key` option threaded through `cacheHook` and `dedupeHook`; both recipes use one shared resolved key per evaluation (compute once in `resolve`, not re-derived per phase, so a non-deterministic user projection cannot desynchronize phases — store it via the existing context-keyed pattern until b07's state bag lands).
- README — Cache Hook and Dedupe Hook sections: key encoding note, `key` option, F2 staleness guidance, migration note that persisted cache entries from earlier versions are simply misses.
- `docs/agents/domain.md` — add "recipe key" vocabulary if the term is used.

## Tests

Extend `src/hooks/__tests__/recipes.test.ts` and `src/__tests__/lifecycle.test.ts`:

- Collision regressions: flag `"a:1"`/id `"2"` vs flag `"a"`/id `"1:2"` get distinct cache entries and distinct dedupe pending slots; `distinctId: 1` vs `"1"` likewise. Assert the provider is called for each distinct evaluation.
- Custom `key` projection: attribute-sensitive projection produces separate entries for `plan: "free"` vs `"pro"` under one `distinctId`; lookup and write use the same projection.
- Key computed once per evaluation: a projection that returns different values on successive calls still settles dedupe correctly (resolve/after/error/finally agree on one key).
- F8 regression (documenting current nondeterminism as tolerated): a leader whose deadline expires during `after` hooks either rejects followers with the timeout or resolves them with the decision — assert followers always settle and the pending map is empty afterward, regardless of which side wins the race.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Recipe cache/dedupe keys use a collision-safe encoding (flag keys containing `:` and numeric vs string `distinctId` no longer collide); `cacheHook`/`dedupeHook` accept a custom `key` projection. Persisted cache entries written by earlier versions are treated as misses."
