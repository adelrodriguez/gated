---
"gated": minor
---

BREAKING: Rework the React integration.

- Rename `createReactHook` to `createReactGate`; no compatibility alias is provided.
  `createReactGate(gatedEvaluator)` remains configuration-free, while custom async
  functions must provide a semantic cache projection, for example
  `createReactGate(customAsyncGate, { cacheKey: (accountId) => accountId })`.
- React gate evaluations use bounded per-identity TTL/LRU promise caching and expose
  `invalidate(identity?)`, `invalidateKey()`, and `clear()`. Cache keys are validated:
  non-plain objects, symbols, functions, bigints, and cycles throw a `TypeError` that names
  the invalid path.
- Add `GateCacheProvider` for per-request cache injection and `pendingTtlMs` to bound
  never-settling evaluations.
- React gates can re-render through `useSyncExternalStore` when their evaluator changes.
- `FeatureGate` names its identity prop `identity` (previously `overrideIdentity`) and
  evaluates beneath its Suspense boundary so `loading` renders for async gates. String
  variant gates used without `match` render the fallback with a development warning.
