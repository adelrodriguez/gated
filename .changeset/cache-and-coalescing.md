---
"gated": minor
---

Add first-class caching, request coalescing, and provider change subscriptions.

- Add `cache` and `onCacheError` gate factory options with the exported `DecisionCache`,
  `DecisionCacheOptions`, and `DecisionCacheErrorReport` types. Cache hits use the
  `"cache"` evaluation source and skip provider and batch work. Custom cache key function
  failures are reported as key operations with the gate flag key.
- Add request coalescing with `buildGate({ coalesce: true })` and an optional custom key
  projection. Default coalescing keys include the gate kind and allowed variants so
  incompatible evaluators for one provider flag key do not share decisions.
- Cache and coalescing keys are collision-safe: flag keys containing `:` and numeric versus
  string `distinctId` values do not collide. Persisted cache entries from earlier versions
  become cache misses.
- Add `subscribe` to gate factory configuration and expose `gate.changes` for provider push
  updates. Changed flags are evicted from caches that support deletion.
