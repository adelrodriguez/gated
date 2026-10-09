---
"gated": patch
---

`GateEvaluator` now carries its identity type and call mode, so `factory.batch()` rejects at compile time gates with a wider, narrower, or differently anonymous identity, and gates from a factory with a different call mode.
