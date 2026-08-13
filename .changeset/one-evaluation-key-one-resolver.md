---
"gated": minor
---

**Breaking:** cache and request coalescing are now one read-through resolver keyed by a single evaluation key, and coalescing is enabled by default.

Migration:

- `cache: { store, key }` → `cache: store` plus the new top-level `evaluationKey` option
- `coalesce: { key }` → `coalesce: true` (or omit it — coalescing is now the default) plus `evaluationKey`
- The `CoalescingOptions` and `DecisionCacheOptions` types are removed
- Set `coalesce: false` to opt out of the new default, for example when `decide` has per-call side effects such as exposure logging; `after` hooks run once per evaluation (including coalesced followers), so hook-based exposure tracking is unaffected

Behavior changes:

- A throwing `evaluationKey` now degrades softly for coalescing too: it is reported through `onCacheError` (operation `"key"`) and the evaluation continues without cache or coalescing, instead of failing the evaluation
- A flag-change notification now drops in-flight coalesced provider work for the changed flags whenever `subscribe` is configured — with or without a cache — so evaluations that start after the notification lead a fresh provider call instead of receiving the pre-change decision
