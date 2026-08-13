# Plan Series C Overview

**Key:** files prefixed `c` (c01–c07) belong to Series C, sourced from
[2026-08-12-react-api-redesign.md](2026-08-12-react-api-redesign.md) and its D
finding IDs. Series A (00–14) and Series B (b01–b13) are complete and removed;
Series C plans never reference their IDs.

Each plan is a vertical slice: implementation + tests + docs (README/CONTEXT.md/
domain.md as applicable) + changeset. Execute in numeric order unless the
dependency notes say otherwise.

| #   | Plan                                       | Fixes / Delivers   | Depends on | Breaking?                              |
| --- | ------------------------------------------ | ------------------ | ---------- | -------------------------------------- |
| c01 | Evaluator back-references in the registry  | D3                 | —          | No (internal seam)                     |
| c02 | Destructurable batch results               | D4                 | —          | Behavioral (batch result object shape) |
| c03 | `GateProvider`, `useGateCache`, live purge | D6, D7             | —          | No (additive; old provider aliased)    |
| c04 | `useGate(evaluator)`                       | D1 partial, D2, D5 | c01, c03   | No (additive)                          |
| c05 | `useGateBatch`                             | D1                 | c02, c04   | No (additive)                          |
| c06 | `FeatureGate` takes evaluators             | D8                 | c04        | Yes (`gate` prop type changes)         |
| c07 | Demote `createReactGate`; docs migration   | D2 closure         | c01–c06    | No (docs and deprecation only)         |

Notes:

- c01 is the foundation seam: one WeakMap next to the flag-key registry. Land it
  first; it is invisible to package consumers.
- c02 and c03 are mutually independent and independent of c01. They can land in
  parallel with it.
- c04 is the center of the series. It builds the shared per-evaluator state
  (caches, namespaces, version stores) that c05 and c06 consume.
- c05 delivers the original goal of the series: N gates, one `decideMany`, one
  suspension, one Suspense reveal.
- c06 is the only API-breaking slice: the `FeatureGate` `gate` prop changes from
  a React hook to an evaluator. Pre-1.0 breaking changes remain acceptable; the
  changeset carries the migration note.
- c07 finishes the story: README rewritten around `useGate`/`useGateBatch`/
  `GateProvider`, `createReactGate` repositioned as the custom-function escape
  hatch, deprecation notes on `GateCacheProvider` and the plain-evaluator
  `createReactGate` overload.
- Consider batching c02 through c06 into one minor release to reduce churn for
  package consumers.
