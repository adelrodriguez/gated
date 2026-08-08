---
"gated": minor
---

Run after hooks for hook-resolved decisions with required metadata identifying the exact resolver, treat null and invalid hook decisions as misses that continue to later hooks or the provider, validate provider decisions before after hooks observe them, and prevent `dedupeHook` from orphaning pending requests. Direct callers of `Hook.after` must now supply the metadata argument. Layered cache hooks now write only when they were consulted and did not supply the accepted decision, avoiding writes to skipped cache layers and duplicate writes from deduped followers when `dedupeHook` runs first. This fixes permanent fallback loops from stale cached decisions and a permanent hang when `dedupeHook` is ordered before `cacheHook`.
