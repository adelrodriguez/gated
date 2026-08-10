---
"gated": minor
---

Run `after` hooks after a decision commits. Slow observers no longer add evaluation latency or consume the evaluation deadline, and failures still report through `onHookError`.

Detached hooks have no drain operation. Short-lived and serverless runtimes must not use `after` or `finally` for durable work that must finish before the runtime exits.
