---
"gated": minor
---

BREAKING: Rework the core evaluation API.

- Decisions now use an explicit `type` discriminant. Replace `{ value }` with
  `decision.boolean(value)` and `{ variant }` with `decision.variant(variant, payload?)`.
  Malformed decisions fall back with a `MalformedDecisionError`. Persisted cache entries
  using the old shape are treated as misses and overwritten.
- Gate evaluators now take an options object. Migrate `await flag({ distinctId })` to
  `await flag({ identity: { distinctId } })`.
- Variant decisions support optional typed payloads. `Decision`, `EvaluationDetails`, and
  `GateEvaluator` gain defaulted payload parameters, so `details().payload` needs no casts.
- Gates expose `details()` with the evaluated value, source (`"cache"`, `"provider"`, or
  `"default"`), flag key, and the underlying error when an evaluation fell back.
- Add `decideMany` and `gate.batch()` for typed batch evaluation with per-flag lifecycle
  and evaluation-detail semantics.
- Gate creation validates options at runtime: keys must be non-empty, variant lists must be
  non-empty and unique, and variant defaults must be declared variants. Empty batches no
  longer resolve identity.
