---
"gated": patch
---

`buildGate` now reads the whole config once when the factory is built. Mutating any config field after `buildGate` — reassigning `decide`, attaching a `cache`, or pushing to the `hooks` array — no longer affects evaluations; pass the final configuration at build time.
