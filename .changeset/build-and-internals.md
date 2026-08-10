---
"gated": patch
---

Publish compiled ESM and TypeScript declarations for every public entry point instead of
exposing source TypeScript files. Export `Decision`, `GateFactory`, and `GateEvaluator`
types from the root entry and fix outdated docs examples. Split the internal evaluation
engine into signal, hook-runner, evaluation, and batch modules with no public API change.
