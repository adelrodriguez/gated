---
"gated": minor
---

Replace createHook with defineHook, which accepts either a direct hook object or a typed options factory. Migrate createHook calls to defineHook; direct hooks no longer need a zero-argument factory invocation.
