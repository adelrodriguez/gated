---
"gated": minor
---

Give hooks an evaluation-scoped `context.state` map for correlating lifecycle phases. Built-in
cache and dedupe recipes now use this state, and the hook context keeps a stable reference for one
evaluation.
