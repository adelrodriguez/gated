# Plan Series B Overview

**Key:** files prefixed `b` (b01–b13) belong to Series B, sourced from [2026-08-09-codebase-review.md](2026-08-09-codebase-review.md) and its F/A/W/T finding IDs. The unprefixed plans 00–14 are Series A, sourced from the 2026-08-06 review (H/API/arch IDs). Series A is complete; Series B plans never reference Series A IDs.

Each plan is a vertical slice: implementation + tests + docs (README/CONTEXT/domain.md as applicable) + changeset. Execute in numeric order unless the dependency notes say otherwise.

| #   | Plan                                      | Fixes / Delivers      | Depends on   | Breaking?                                 |
| --- | ----------------------------------------- | --------------------- | ------------ | ----------------------------------------- |
| b01 | Collision-safe, pluggable recipe keys     | F1, F2, F8 (test), T1 | —            | Behavioral (persisted cache keys change)  |
| b02 | Runtime gate-option validation, hardening | F3, F5, F9, T1        | —            | Behavioral (invalid configs now throw)    |
| b03 | React cache-key safety + invalidation DX  | F4, F11, T1           | —            | Yes (previously accepted keys now throw)  |
| b04 | After-hook latency policy                 | F7                    | —            | Behavioral (after hooks leave hot path)   |
| b05 | Anonymous per-call override               | F6                    | —            | No (additive)                             |
| b06 | Typed variant payloads                    | A1                    | —            | Yes (type-level; runtime unchanged)       |
| b07 | Per-evaluation hook state                 | A2                    | b01, b04     | No (additive; recipes migrate internally) |
| b08 | Fallback observability (`onFallback`)     | A3                    | —            | No (additive)                             |
| b09 | Optional `identify`                       | A4                    | b05          | No (additive overload)                    |
| b10 | Engine module split + explicit batch seam | W1, W2                | b02, b04–b08 | No (pure refactor)                        |
| b11 | Core coalescing spike (dedupe in core)    | W3                    | b07, b10     | TBD by spike outcome                      |
| b12 | Reactive flag updates (`subscribe`)       | A5                    | b10          | No (additive)                             |
| b13 | React SSR cache provider + pending bounds | A6, F10               | b03          | No (additive)                             |

Notes:

- b01–b03 are the correctness wave: F1 and F4 produce silent wrong flag values today. Land these first; they are mutually independent.
- b01 changes the encoding of persisted cache keys, so existing cache entries orphan on upgrade (they expire naturally; the legacy-decision bypass already tolerates unknown shapes). Call this out in the changeset.
- b04 is a design decision as much as a code change; its outcome (fire-and-forget after hooks) affects how b07's state bag documents post-evaluation writes, hence the dependency.
- b10 is a pure refactor and intentionally scheduled after the behavioral plans that touch `src/lib/index.ts` (b02, b04, b05, b08) to avoid rebase churn. No public API changes.
- b11 is a spike with an explicit go/no-go: keep dedupe as a recipe (with b07's state bag) or promote coalescing into core config. Do not start implementation before the spike concludes.
- b12 and b13 are the feature-level roadmap; they can proceed in parallel once their dependencies land.
- Breaking changes remain acceptable pre-1.0; each needs a changeset with a migration note. Consider batching b03 and b06 into one minor release to reduce churn.
