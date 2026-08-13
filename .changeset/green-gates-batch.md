---
"gated": minor
---

Redesign the React integration around evaluators. Add destructurable server batch results, `useGate`, `useGateBatch`, `GateProvider`, `createGateCache`, `useGateCache`, live invalidation, and cache prefetch methods. `FeatureGate` now accepts an evaluator. Remove `createReactGate` and `GateCacheProvider`.

Migration:

- Replace `const useX = createReactGate(flag)` and `useX()` with `useGate(flag)`.
- Replace `useX(identity)` with `useGate(flag, { identity })`.
- Replace generated-hook invalidation methods with methods on `useGateCache()` or an explicit cache. A cache read through `useGateCache()` defaults to the provider identity; a directly constructed cache always needs an explicit identity.
- Replace `GateCacheProvider` with `GateProvider`.
- Replace custom `cacheKey` hooks with `useGate(() => fn(...args), { key })`.
