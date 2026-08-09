# b13 — React SSR cache provider and pending-entry bounds

Fixes: A6, F10. Depends on: b03. Additive.

## Goal

Per-request cache injection works through React context — matching how SSR apps actually structure module-scope hooks — and a hung evaluation can no longer pin cache entries forever.

## Problem

- **A6.** The README's SSR guidance ("create a cache for each request", "never share that cache across requests") is only achievable today by calling `createReactGate` per request, but hooks are naturally module-scope. The README example itself reads as module scope, i.e. the documented pattern quietly violates the documented rule. There is no context-based seam to inject a request's cache into module-scope hooks.
- **F10.** Pending entries are exempt from TTL/LRU by design (prevents Suspense retry loops), but a promise that never settles — hung provider, no `timeoutMs` — is pinned forever. Under identity churn the cache grows without bound, and on the server that means cross-request memory growth.

## Design

1. Context provider:

```tsx
import { GateCacheProvider, createReactGateCache } from "gated/react"

// module scope — no cache bound
const useBetaAccess = createReactGate(betaFlag)

// per request / per app segment
<GateCacheProvider cache={createReactGateCache()}>
  <App />
</GateCacheProvider>
```

- `createReactGate` resolution order: explicit `cache` option (unchanged, wins) → nearest `GateCacheProvider` → the hook's own default cache (today's behavior). The provider-supplied cache is namespaced per hook exactly like an injected one (existing `cacheNamespace` machinery).
- The hook reads context via `use(GateCacheContext)` inside the render path only; `invalidate`/`clear` are module-level and cannot see context — document that with a provider, invalidation goes through the cache object (`cache.clear()`, or `invalidateKey` on the cache via a small helper `gateCacheKeyOf(hook, ...args)` if needed; keep this minimal — start with documenting `cache`-object invalidation and add helpers only on demand).
- Suppressing the shared-module-default-on-server footgun: when `NODE_ENV !== "production"` and a default (unbounded-lifetime, module-scope) cache is used during server rendering (`typeof window === "undefined"`), log a one-time development warning recommending `GateCacheProvider`. Mirrors the existing FeatureGate dev warning style.

2. Pending-entry bounds in `createReactGateCache`:

- New option `pendingTtlMs` (default: none, preserving current semantics; README recommends setting it or a core `timeoutMs`). When set, a pending entry older than `pendingTtlMs` becomes evictable by LRU pressure and prunable by TTL sweep — eviction only detaches the cache reference; the in-flight promise itself is untouched (consistent with core's "work that ignores cancellation may finish in the background").
- A later settlement of an evicted-pending promise must not resurrect the entry (the `evictOnRejection`/newer-entry guard in `createReactGate` already checks reference identity on delete; verify the settle path with the same guard).

## Changes

- `src/integrations/react.tsx` — `GateCacheContext` + `GateCacheProvider`; resolution order in `useGateValue`; dev warning; `pendingTtlMs` in `createReactGateCache` (`pruneEntries` and LRU loop consider expired-pending entries evictable).
- README — SSR section rewritten around the provider (fixes the module-scope contradiction); pending-bounds paragraph updated from "never expired or evicted" to the new conditional wording; migration note: default behavior unchanged.

## Tests

Extend `src/__tests__/react.test.tsx`:

- Provider cache is used when no option cache is set; option cache wins over provider; sibling providers isolate; two hooks sharing one provider cache stay namespaced.
- Same hook rendered under two different providers (sequential renders) uses each provider's cache — no bleed-through.
- `pendingTtlMs`: an expired pending entry is evicted under LRU pressure while a fresh pending entry is not; its late settlement does not reinsert or overwrite a newer entry for the same key; default (unset) preserves the existing "pinned while pending" tests unchanged.
- Dev warning fires once for a module-default cache in a simulated server environment and never in production mode.

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `GateCacheProvider` for per-request React cache injection and `pendingTtlMs` to bound never-settling evaluations. Defaults unchanged."
