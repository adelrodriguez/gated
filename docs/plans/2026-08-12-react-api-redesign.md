# 2026-08-12 React API redesign

Source document for Plan Series C. Findings use D IDs. They come from an API design
review of the React integration and the batch surface, not from a codebase review.
The trigger question was: "how do we wait for three gates before rendering?" The
answer exposed structural problems in the current React API.

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

## Decisions

1. Evaluators become the single currency on the server and the client. The server
   awaits them; the client passes them to hooks and components.
2. New client surface: `useGate(evaluator, identity?)`,
   `useGateBatch([evaluators], identity?)`, `GateProvider`, `useGateCache()`.
3. `useGateBatch` is the answer to "wait for N gates": one cached `batch()`
   promise, one suspension, one `decideMany` round trip, one Suspense reveal.
4. `gate.batch` results become destructurable tuples; `get()`/`details()` remain.
5. `GateProvider` creates its own cache when none is passed and accepts an
   optional default `identity`. `GateCacheProvider` remains as a deprecated alias
   seam during migration.
6. Invalidation goes through the cache: `useGateCache()` in components, a handle
   over the cache object outside React. Invalidation bumps version stores and
   re-renders subscribers.
7. `FeatureGate` takes an evaluator. `match` and `identity` types derive from it.
8. `createReactGate` survives only as the escape hatch for arbitrary async
   functions with a `cacheKey` projection. The plain-evaluator overload is
   deprecated in docs.
9. Rejected: a `GateClient` object and `useGateClient` naming. Gated's currency is
   evaluators plus a cache; a client object adds a concept without capability.
10. Deferred: a `FeatureGates` render-prop plural. `useGateBatch` covers the batch
    case in plain code; add the component only on demonstrated demand.
11. Deferred: implicit DataLoader-style same-tick batching of single-gate hooks.
    It cannot fix the intra-component waterfall (D1), adds a tick of latency to
    every evaluation, and is invisible. Revisit only if cross-component batching
    without code changes becomes a requirement.
