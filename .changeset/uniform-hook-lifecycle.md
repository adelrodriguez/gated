---
"gated": minor
---

Run after hooks for hook-resolved decisions with metadata identifying the exact resolver, treat null and invalid hook decisions as misses that continue to later hooks or the provider, validate provider decisions before after hooks observe them, expose `HookResolutionAbortError` for custom single-flight hooks, and prevent `dedupeHook` from orphaning pending requests. This fixes permanent fallback loops from stale cached decisions and a permanent hang when `dedupeHook` is ordered before `cacheHook`.
