---
"gated": minor
---

Add core request coalescing with `buildGate({ coalesce: true })` and an optional custom key
projection. Default coalescing keys include the gate kind and allowed variants so incompatible
evaluators for one provider flag key do not share decisions. Deprecate `dedupeHook`; it remains
available through this major release and is planned for removal in the next major release.
