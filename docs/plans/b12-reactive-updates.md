# b12 — Reactive flag updates (`subscribe`)

Fixes: A5. Depends on: b10 (lands in the split engine), b03 (React cache-key contract). Additive.

## Goal

Streaming providers (LaunchDarkly, PostHog) can push flag changes through Gated, and React components re-render when a subscribed flag changes — closing the documented "invalidation is not reactive" gap.

## Problem

The React cache is TTL-plus-manual-invalidation: `invalidate()`/`clear()` take effect on the next render and schedule nothing. A flag flipped mid-session (kill switch, progressive rollout) is invisible until an unrelated render after TTL expiry. Providers already expose change streams; Gated has no seam to receive them, so consumers bolt polling or ad-hoc listeners around the library.

## Design

1. Provider seam in config (all-flags granularity; per-key filtering is the consumer's provider adapter's job):

```ts
type GatedConfig<TIdentity> = {
  // ...existing
  subscribe?: (notify: (change: { keys?: readonly string[] }) => void) => () => void
}
```

`subscribe` is called lazily on first listener attachment and its unsubscribe invoked when the last listener detaches. `notify({ keys })` invalidates the named flags; `notify({})` invalidates all. Gated does not interpret payloads — a change means "re-evaluate".

2. Factory-level change hub: the factory exposes `gate.changes` — `{ subscribe(listener: (keys?: readonly string[]) => void): () => void }` — fanning out provider notifications. Core evaluation itself stays pull-based (no decision cache in core to invalidate; recipes' caches are the consumer's concern — document that a cache recipe should subscribe and evict, and ship that wiring in the cache recipe: `cacheHook(cache, { changes: gate.changes })` deletes affected keys).

3. React integration: `createReactGate` accepts `changes` (the hub). Implementation: keep the promise cache, add a per-key version counter bumped by notifications; the hook subscribes via `useSyncExternalStore` to the version, and a version bump both evicts the cache entry and triggers re-render → re-evaluate → suspend/transition. Notifications for keys the component does not use cause no work (version store is per cache key). Gated evaluators expose their flag key to the React layer via the factory `definitions` WeakMap — add a narrow internal accessor rather than parsing anything.

4. SSR: `subscribe` is client-oriented; a request-scoped server render never attaches (no listener during render). Document this.

## Changes

- `src/lib/types.ts` / `src/factory.ts` — `subscribe` config, `gate.changes` hub (lazy attach/detach, listener error isolation via the shared consume-everything reporter).
- `src/hooks/recipes.ts` — `cacheHook` optional `changes` wiring.
- `src/integrations/react.tsx` — version store + `useSyncExternalStore` path; `changes` option; eviction on notify.
- README — new "Reactive updates" section with a LaunchDarkly streaming example; React section updated ("invalidation is not reactive" paragraph replaced by the two modes).

## Tests

- Core: lazy subscribe (provider `subscribe` not called until a listener attaches; unsubscribed when last detaches); `notify` fan-out; throwing listener isolated.
- Recipe: cache entries for notified keys evicted; unnotified keys retained.
- React (`src/__tests__/react.test.tsx`): a rendered component re-renders with the new value after `notify({ keys: ["beta-access"] })` (async provider both times); notification for an unused key causes no re-render (render-count probe); unmount detaches the listener.

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `subscribe` to `buildGate` config and `gate.changes` for provider push updates; `cacheHook` can evict on change and React gates re-render reactively via `useSyncExternalStore`."
