# c03 — `GateProvider`, `useGateCache`, live invalidation

Fixes: D6, D7. Depends on: —. Additive; `GateCacheProvider` becomes a deprecated
alias.

## Goal

Mounting a bare `<GateProvider>` gives every subtree an isolated cache — fresh
per server request by construction, singleton per browser tab. Components obtain
the active cache with `useGateCache()` and invalidate through it; invalidation
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

1. Provider:

```tsx
export function GateProvider(props: {
  cache?: ReactGateCache
  identity?: Identity
  children: ReactNode
}): ReactNode
```

- When `cache` is omitted, the provider creates one with
  `useState(() => createGateCache())`. A fresh element tree per server request
  yields a fresh cache per request; on the client the cache lives as long as the
  provider. The `cache` prop remains for tests and shared-cache setups.
- `identity` is a default call identity for descendant hooks (consumed in c04):
  an explicit hook argument wins over the provider value. The provider only
  stores it in context; it does not evaluate anything.
- Context value is `{ cache, identity }`. `GateCacheProvider` re-exports as a
  thin wrapper over `GateProvider` with a required `cache` and no `identity`,
  marked `@deprecated` in TSDoc. Removal is a later major.

2. `useGateCache()`:

- Returns a `GateCacheHandle`: `{ invalidate(flag, identity?), clear(), cache }`.
- Resolution: nearest provider cache, else the shared module default cache the
  integration owns (see c04 for its introduction; until c04 lands the handle
  resolves provider-or-throw with a clear error, keeping this slice landable
  first).
- `invalidate(flag, identity?)` derives the entry key from the evaluator's
  namespace plus the serialized identity (the existing `deriveKey`/`serializeKey`
  machinery), deletes the entry, and bumps the matching version store so
  subscribed components re-render and re-evaluate. `clear()` does the same for
  every store attached to that cache.
- Outside React: export `createGateCacheHandle(cache)` returning the same handle
  shape, for websocket handlers, route loaders, and actions. `useGateCache` is
  sugar over it.

3. Version-store bump on invalidation:

- The store registry is keyed by `(cache, key)` (`storesByCache`,
  `react.tsx:120`). Move it from the `createReactGate` closure to module scope in
  the integration so handles and hooks share it (c04 completes this move; this
  slice hoists the registry and keeps `createReactGate` delegating to it).
- The existing `bump()` already deletes the entry and notifies listeners
  (`react.tsx:164`); `invalidate` reuses it. Document the behavior change: the
  old statics stayed passive; handle invalidation re-renders.

## Changes

- `src/integrations/react.tsx` — `GateProvider`, context shape, `useGateCache`,
  `createGateCacheHandle`, hoisted store registry, deprecated
  `GateCacheProvider` wrapper.
- README — SSR section rewritten around bare `<GateProvider>`; invalidation
  section rewritten around handles.
- domain.md — add **gate provider** and **cache handle** vocabulary rows.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Bare provider isolates: two sibling providers do not share entries; two
  renders of the same tree with fresh providers do not share entries.
- `cache` prop wins over auto-creation; `GateCacheProvider` alias still works.
- `useGateCache().invalidate(flag)` evicts and re-renders a subscribed
  component, which re-evaluates (fresh provider call observed).
- `invalidate(flag, identityA)` does not evict `identityB`'s entry.
- `createGateCacheHandle` invalidates from outside a component and subscribed
  components re-render.
- `clear()` re-renders all subscribers of that cache.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `GateProvider` with an auto-created per-mount cache,
  `useGateCache`, and re-rendering invalidation handles. `GateCacheProvider` is
  deprecated but unchanged."
