# c03 — `GateProvider`, `createGateCache`, `useGateCache`

Fixes: D6, D7. Depends on: —. Additive; the existing `GateCacheProvider` is
untouched until c07 removes it.

## Goal

Mounting a bare `<GateProvider>` gives every subtree an isolated cache — fresh
per server request by construction, singleton per browser tab. The cache object
owns invalidation; `useGateCache()` returns the active cache; invalidation
re-renders subscribers.

## Problem

- **D6.** `GateCacheProvider` requires the consumer to build the cache. The only
  guard against sharing the module-scope default across server requests is a
  development `console.error` (`src/integrations/react.tsx:216`). Safety should
  be structural, not advisory.
- **D7.** `invalidate`/`clear` statics delete entries without scheduling a render
  (`react.tsx:54-60`) and only touch the hook's default cache; a provider cache
  is unreachable from them. Nothing resolves the active cache from context, so
  components cannot invalidate correctly at all under a provider.

## Design

1. Cache object. `createGateCache(options?)` returns the one cache concept the
   React layer has — store and invalidation surface on the same object:

```ts
type ReactGateCache = {
  invalidate(flag: AnyGateEvaluator, identity?: Identity): void
  invalidateBatch(flags: readonly AnyGateEvaluator[], identity?: Identity): void
  invalidateKey(key: GateCacheKey): void
  clear(): void
  // plus the internal store contract the hooks use (get/set/delete on entries)
}
```

- Internal structure: per-gate buckets keyed by evaluator object, plus one
  custom-key bucket for `useGate(fn, { key })` entries (c04). Entry keys inside
  a gate bucket are serialized identities. This replaces the namespace
  machinery entirely — buckets cannot collide across gates or factories — and
  bounds (`maxEntries`, `ttlMs`, `pendingTtlMs`) apply per bucket, so one
  gate's identity churn cannot evict another gate's entries.
- Invalidation deletes the entry and bumps the matching version store so
  subscribed components re-render and re-evaluate. `clear()` does this for
  every bucket. This changes the old semantics deliberately: the deprecated
  statics stayed passive; cache invalidation is live. `invalidateKey` targets
  custom-key entries (c04's fn form).
- Outside React needs no extra concept: whoever passes `cache` to the provider
  holds the reference and calls the same methods from websocket handlers, route
  loaders, or actions.

2. Provider:

```tsx
export function GateProvider(props: {
  cache?: ReactGateCache
  identity?: Identity
  children: ReactNode
}): ReactNode
```

- When `cache` is omitted, the provider creates one with
  `useState(() => createGateCache())`. A fresh element tree per server request
  yields a fresh cache per request; on the client the cache lives as long as
  the provider. The `cache` prop connects `createGateCache(options)` for tuned
  bounds, SSR plumbing that needs to hold the reference, and tests.
- Placement rule: mount `GateProvider` above the Suspense boundaries of its
  consumers. `useState` is stable only across commits — a provider mounted
  inside the boundary its own hooks suspend in never commits its initial
  render, so the initializer can run again on retry, producing a new cache and
  a new promise on every retry. Document the rule and pin the behavior with a
  test; the "structural safety" claim (D6) holds under the rule, not without
  it.
- `identity` is a value prop: a default call identity for descendant hooks
  (consumed in c04). An explicit hook option wins over the provider value. The
  value participates in cache keys at render time and drives context updates
  when it changes (login/logout re-keys descendant evaluations naturally).
- Context value is `{ cache, identity }`. `GateCacheProvider` is left as-is
  until c07 deletes it; the two providers coexist during the series because
  `createReactGate` hooks read the old context and `useGate` reads the new one.

3. `useGateCache()` returns the context cache, else the integration's
   module-scope default cache (a `createGateCache()` instance shared by
   `useGate` when no provider is mounted — introduced here, consumed by c04).
   The server-rendering development warning about the module default moves to
   this resolution path, with its message updated to recommend `GateProvider`.

4. Version stores move from the `createReactGate` closure to module scope in
   the integration, keyed by `(cache, bucket, entryKey)`, so cache methods and
   hooks share them. `createReactGate` keeps its own closure stores until c07
   deletes it; this slice only hoists the registry the new surface uses.

## Changes

- `src/integrations/react.tsx` — `createGateCache` (bucketed store +
  invalidation methods), `GateProvider`, context shape, `useGateCache`, hoisted
  version-store registry, dev warning on the default-cache path.
- README — SSR section rewritten around bare `<GateProvider>`; invalidation
  section rewritten around the cache object.
- domain.md — add **gate provider** and **gate cache** vocabulary rows.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Bare provider isolates: two sibling providers do not share entries; two
  renders of the same tree with fresh providers do not share entries.
- `cache` prop wins over auto-creation.
- Placement rule: a provider mounted inside the Suspense boundary its consumers
  suspend in — pin the retry behavior the documented rule warns about.
- `cache.invalidate(flag)` evicts and re-renders a subscribed component, which
  re-evaluates (fresh provider call observed); `invalidate(flag, identityA)`
  does not evict `identityB`'s entry.
- Bucket isolation: filling one gate's bucket past `maxEntries` does not evict
  another gate's entries.
- Invalidation from outside a component (direct method call on the cache
  reference) re-renders subscribers.
- `clear()` re-renders all subscribers of that cache.
- Entrypoint pins: `GateProvider`, `useGateCache`, and `createGateCache` join
  the runtime surface in `src/__tests__/entrypoints.test.ts`; the
  `ReactGateCache` shape gets a type-level assertion in
  `src/__tests__/entrypoints.types.ts`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `GateProvider` with an auto-created per-mount cache,
  `createGateCache` with live invalidation methods, and `useGateCache`.
  Existing APIs unchanged until the removal slice."
