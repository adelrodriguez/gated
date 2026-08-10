---
"gated": minor
---

Gate creation now validates options at runtime. Variant defaults must be declared variants, keys must be non-empty, and variant lists must be non-empty and unique. Empty batches no longer resolve identity, and each evaluation uses a fixed hook-list snapshot.
