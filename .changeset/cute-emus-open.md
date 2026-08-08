---
"gated": minor
---

Rename `createReactHook` to `createReactGate` because the returned callable represents a React-bound gate and now includes cache controls. Consumers must replace the old import and factory call with `createReactGate`; no compatibility alias is provided.

React gate evaluations now use bounded per-identity TTL/LRU promise caching, expose `invalidate(identity?)` and `clear()`, and accept an injectable request-scoped cache. `FeatureGate` now evaluates beneath its Suspense boundary so `loading` renders for async gates, and string variant gates used without `match` render the fallback with a development warning.
