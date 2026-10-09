---
"gated": patch
---

`factory.batch()` now rejects at compile time gates whose identity type does not match the factory. Gates from a different factory with the same identity type still cause a `ForeignGateEvaluatorError` at runtime.
