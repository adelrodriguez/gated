---
"gated": patch
---

Evaluation state (request coalescing and cache invalidation tracking) is now owned by each gate factory instead of module-level maps keyed by config identity. Two factories built from the same config object no longer share coalesced provider work or cache invalidation bookkeeping.
