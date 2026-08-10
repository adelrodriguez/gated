---
"gated": minor
---

Validate React gate cache keys so non-plain objects, symbols, functions, bigints, and cycles throw a `TypeError` that names the invalid path instead of silently colliding. Add `invalidateKey()` to custom React gates so consumers can invalidate a projected key without operational arguments.
