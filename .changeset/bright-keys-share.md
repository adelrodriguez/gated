---
"gated": minor
---

Use collision-safe cache and dedupe recipe keys so flag keys containing `:` and numeric versus
string `distinctId` values do not collide. Add a custom `key` projection to `cacheHook` and
`dedupeHook`. Persisted cache entries from earlier versions become cache misses.
