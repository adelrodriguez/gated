---
"gated": minor
---

Enrich `HookContext` with readonly gate metadata and make `cacheHook` self-heal stale cached decisions.

`HookContext` now exposes a discriminated `kind`, `defaultValue`, and `variants` for variant gates. It accepts only the identity generic, so consumers using the removed options generic must delete that second type argument. When a cached decision's boolean/variant shape does not match the current gate or its variant is no longer supported, `cacheHook` reports the mismatch through `onHookError`, consults the provider, and replaces the stale cache entry.
