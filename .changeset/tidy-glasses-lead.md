---
"gated": minor
---

Enrich `HookContext` with readonly gate metadata and make `cacheHook` self-heal type-mismatched cached decisions.

`HookContext` now exposes `kind`, `defaultValue`, and optional `variants`. It accepts only the identity generic, so consumers using the removed options generic must delete that second type argument. When a cached decision's boolean or variant shape does not match the current gate, `cacheHook` now consults the provider and replaces the stale cache entry.
