---
"gated": minor
---

Decisions now use an explicit `type` discriminant and variants support optional payloads.

Replace `{ value }` with `decision.boolean(value)` and `{ variant }` with `decision.variant(variant, payload?)`. Persisted cache entries using the old shape are treated as misses and overwritten with the new shape.

JavaScript consumers and untyped provider adapters must migrate too: decisions without a valid `type` discriminant, boolean decisions with a non-boolean `value`, and variant decisions with a non-string `variant` now fall back with a `MalformedDecisionError`.
