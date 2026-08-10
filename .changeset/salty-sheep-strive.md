---
"gated": minor
---

Add `subscribe` to gate factory configuration and expose `gate.changes` for provider push updates. Cache recipes can evict changed flags, and React gates can re-render through `useSyncExternalStore` when their evaluator changes.
