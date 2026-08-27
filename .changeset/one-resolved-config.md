---
"gated": patch
---

`buildGate` now snapshots the `hooks` array when the factory is built. Mutating the config's `hooks` array after `buildGate` no longer affects evaluations; pass the final hook list at build time.
