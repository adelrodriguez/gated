---
"gated": minor
---

Type variant payloads per gate so `details().payload` and `batch.details().payload` do not require casts. Add defaulted payload parameters to `Decision`, `EvaluationDetails`, and `GateEvaluator`, and remove the impossible payload field from boolean-gate details.
