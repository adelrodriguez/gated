# Plan Series C Overview

**Key:** files prefixed `c` (c01–c08) belong to Series C, sourced from
[2026-08-12-react-api-redesign.md](2026-08-12-react-api-redesign.md) and its D
finding IDs. Series A (00–14) and Series B (b01–b13) are complete and removed;
Series C plans never reference their IDs.

Each plan is a vertical slice: implementation + tests + docs (README/CONTEXT.md/
domain.md as applicable) + changeset. Execute in numeric order unless the
dependency notes say otherwise.

| #   | Plan                                              | Fixes / Delivers   | Depends on | Breaking?                              |
| --- | ------------------------------------------------- | ------------------ | ---------- | -------------------------------------- |
| c01 | Evaluator back-references in the registry         | D3                 | —          | No (internal seam)                     |
| c02 | Destructurable batch results                      | D4                 | —          | Behavioral (batch result object shape) |
| c03 | `GateProvider`, `createGateCache`, `useGateCache` | D6, D7             | —          | No (additive)                          |
| c04 | `useGate(evaluator)` with hook options            | D1 partial, D2, D5 | c01, c03   | No (additive)                          |
| c05 | `useGateBatch`                                    | D1                 | c02, c04   | No (additive)                          |
| c06 | `FeatureGate` takes evaluators                    | D8                 | c04        | Yes (`gate` prop type changes)         |
| c07 | Remove `createReactGate` and `GateCacheProvider`  | D2 closure         | c01–c06    | Yes (removal)                          |
| c08 | Preload seam (`cache.prefetch`)                   | decision 14        | c03–c05    | No (additive)                          |

Notes:

- c01 is the foundation seam: one WeakMap next to the flag-key registry. Land it
  first; it is invisible to package consumers.
- c02 and c03 are mutually independent and independent of c01. They can land in
  parallel with it.
- c04 is the center of the series. It defines hook options, key derivation, and
  the per-gate-bucket cache use that c05, c06, and c08 build on.
- c05 delivers the original goal of the series: N gates, one `decideMany`, one
  suspension, one Suspense reveal.
- c06 and c07 are the breaking slices. c06 changes the `FeatureGate` `gate`
  prop; c07 deletes `createReactGate` and `GateCacheProvider` outright — the
  final surface has no definition step and no per-hook cache option, so nothing
  references them after c04–c06 land. Pre-1.0 breaking changes remain
  acceptable; the c07 changeset carries the full migration table.
- c08 is additive polish and can land any time after c05.
- Ship c02 through c07 as one minor release: the React entrypoint is effectively
  new, and consumers should migrate once, not four times.
