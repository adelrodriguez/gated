# 2026-08-12 React API redesign

Source document for Plan Series C. Findings use D IDs. They come from an API design
review of the React integration and the batch surface, not from a codebase review.
The trigger question was: "how do we wait for three gates before rendering?" The
answer exposed structural problems in the current React API.

Revision note: the Decisions section was revised after review. The first revision
kept `createReactGate` as a deprecated escape hatch and configured caches through
hook factories. The final design removes `createReactGate` entirely and moves all
per-gate configuration to hook options.

## Findings

- **D1 — Hook waterfall.** A component that calls three `createReactGate` hooks
  evaluates them serially. The first `use()` suspends before the second hook runs,
  so the second promise does not exist until the first resolves
  (`src/integrations/react.tsx:244`). Three gates cost three sequential provider
  round trips. Nothing in the React layer can reach `decideMany`.
- **D2 — Factory boilerplate.** `createReactGate(evaluator)` adds a mandatory
  wrapping step that carries no information. The example app shows the cost:
  `examples/react/src/shared/gates/client.ts:44-46` is three lines of
  `export const useX = createReactGate(clientX)`. Evaluators are already stable
  module-scope identities; a hook can key its state off them directly.
- **D3 — No evaluator back-reference.** The registry stores only a flag key per
  evaluator (`src/lib/evaluation/registry.ts`). An evaluator cannot reach the
  factory that created it, so `batch()` is unreachable from a list of evaluators
  and the React layer cannot auto-wire `changes`.
- **D4 — Batch read ergonomics.** `gate.batch([a, b])` returns an object that
  requires a second reference per flag: `batch.get(a)`. A tuple-typed result
  allows `const [aValue, bValue] = await gate.batch([a, b])`.
- **D5 — Manual `changes` wiring.** Live flag updates require the consumer to pass
  `changes: gate.changes` to every `createReactGate` call. With D3 solved, the
  integration can wire this automatically.
- **D6 — SSR cache safety by warning, not structure.** `GateCacheProvider`
  requires the consumer to build the per-request cache. The only guard against
  sharing the module-scope default cache across requests is a development
  `console.error` (`src/integrations/react.tsx:216`). A provider that creates its
  own cache per mount makes the leak structurally impossible.
- **D7 — Passive, default-cache-only invalidation.** The `invalidate`/`clear`
  statics delete entries without scheduling a render
  (`src/integrations/react.tsx:54-60`) and only reach the hook's default cache,
  never a provider-supplied cache. Components also have no way to obtain the
  active cache; nothing resolves it from context.
- **D8 — `FeatureGate` receives a hook as a prop.** `GateSlot` calls the `gate`
  prop as a hook (`src/integrations/react.tsx:279`). Passing hooks as props is
  legal but fragile under lint rules and the React Compiler, and the `match` type
  must be recovered through `ReturnType` instead of the evaluator's variants.

## The final surface

```tsx
useGate(flag, { identity, ttlMs, details }?)   // evaluator; key auto-derived
useGate(fn, { key, ttlMs })                     // arbitrary async fn; key required
useGateBatch([a, b, c], { identity, ttlMs }?)  // one decideMany, one suspension
useGateCache()                                  // returns the active cache
<FeatureGate gate={flag} match? identity? loading? fallback? />
<GateProvider cache? identity? />               // bare mount auto-creates a cache
createGateCache(options?)                       // cache object with invalidation methods
```

Removed: `createReactGate`, `GateCacheProvider`.

## Decisions

1. Evaluators are the single currency on the server and the client. The server
   awaits them; the client passes them to hooks and components.
2. Per-gate configuration lives in hook options, per call site (the TanStack
   Query model). There is no definition step of any kind: no `createReactGate`,
   no `defineReactGate`. A consumer who wants a named hook writes a plain
   wrapper function (`const useBetaAccess = () => useGate(betaAccess, {...})`);
   that is a consumer convention, not a library API.
3. `useGateBatch` is the answer to "wait for N gates": one cached `batch()`
   promise, one suspension, one `decideMany` round trip, one Suspense reveal.
4. `gate.batch` results become destructurable tuples; `get()`/`details()` remain.
5. A promise cache is mandatory, not an optimization: `use()` requires the same
   promise object across render attempts, so an uncached promise created in
   render suspends forever. The cache is the termination mechanism.
6. Cache keys: for evaluators, the key derives from the flag key plus the
   resolved identity (or an identify sentinel when the core `identify` resolves
   it). The `key` option exists only for the arbitrary-function form, where it
   is required — the caller computes it from the arguments it already has,
   which is why no `cacheKey` projection (and no definition step) is needed.
7. The cache stores per-gate buckets plus a custom-key bucket, eliminating the
   namespace machinery and cross-gate eviction: one gate's identity churn cannot
   evict another gate's entries.
8. `GateProvider` is demoted to two jobs: per-request cache isolation during
   SSR (auto-created via `useState` when no `cache` prop is passed) and a
   default `identity` value for descendant hooks. Client-only apps never mount
   it. Placement rule: mount it above the Suspense boundaries of its consumers.
9. `identity` on the provider is a value prop, not a function: the value
   participates in cache keys at render time and drives context updates.
10. Invalidation methods live on the cache object itself
    (`invalidate`/`invalidateKey`/`invalidateBatch`/`clear`); `useGateCache()`
    returns the active cache. There is no separate handle concept. Invalidation
    bumps version stores and re-renders subscribers.
11. `useGate(flag, { details: true })` returns evaluation details instead of the
    value. One cache entry serves both forms: the entry caches the details
    evaluation and the value form projects `.value` from it.
12. `FeatureGate` takes an evaluator. `match` and `identity` types derive from it.
13. Rejected: a `GateClient` object and `useGateClient` naming; `defineReactGate`
    or any definition step; a per-hook `cache` option (the provider is the only
    cache seam).
14. Planned (c08): a preload seam on the cache (`cache.prefetch`) for route
    loaders and hover warming.
15. Deferred: a `FeatureGates` render-prop plural (`useGateBatch` covers it in
    plain code) and implicit DataLoader-style same-tick batching (cannot fix the
    intra-component waterfall, adds a tick of latency, invisible).
