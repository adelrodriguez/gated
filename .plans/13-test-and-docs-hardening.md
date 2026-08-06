# 13 — Test & docs hardening

Delivers: review section 4 (testing/maintainability), residual items not absorbed by earlier slices. Depends on: all prior plans (run last; also fine to run after 05 if later slices stall). Non-breaking, no changeset (test/docs only) unless doc fixes touch published behavior descriptions.

## Goal

The suite tests behavior, not shape. Docs cannot silently drift. Every bug class found in the review has a standing regression net.

## 1. Prune shape-only tests

Delete or replace assertions that test JavaScript rather than gated:

- `src/__tests__/react.test.tsx:9-59` — `typeof`, `.name` prefix, `.length` checks (superseded by plan 05's behavioral tests).
- `src/hooks/__tests__/index.test.ts` — most of this file asserts that a factory returns what it was given (`expect(hook).toBe(factory)`, per-method identity checks). Keep one identity test and the typed-options test; drop the rest.
- `src/__tests__/core.test.ts` — collapse duplicates ("handles identify function that returns Promise" and "handles decide function that returns Promise" are the same test as the basic boolean case).

## 2. Consolidate the integration suite

Plans 03/04 created `src/__tests__/lifecycle.test.ts`. Finish it as the canonical behavior net:

- Lifecycle-order table test: for each decision source (hook / provider / default-via-error), assert the exact sequence of phases each hook observes.
- Recipe matrix: `[cache]`, `[dedupe]`, `[cache, dedupe]`, `[dedupe, cache]` × {hit, miss, provider error, concurrent × 5} — assert values, provider call counts, and absence of hangs (every test wrapped in an aggressive timeout).
- Property-style invariant: for a randomized mix of hostile hooks (throwing in random phases) and provider outcomes, the gate promise always settles and never rejects. A simple loop over ~100 generated cases is enough; no property-testing dependency needed.

## 3. React async coverage

Verify plan 05's suite includes (add if missing): loading fallback during suspension, single evaluation per identity across re-renders, error-boundary propagation and retry, `FeatureGate` + variant flows against a real `buildGate` gate (not a hand-mock) — the one seam react.test.tsx never crosses today.

## 4. Type-checked doc snippets

Prevent H7-style drift structurally:

- Extract every README/JSDoc code block into `docs/snippets/*.ts(x)` files that import from the built entry points (`gated`, `gated/hooks/recipes`, `gated/react`) and are included in `tsconfig` for `bun run check` — compile-only, no runtime assertions.
- Either generate README blocks from these files (markers + a small sync script) or add a CI check that diffs snippet content against README blocks. Prefer the marker/sync script: one source of truth.
- Fix remaining drift found during extraction (audit CONTEXT.md and docs/agents/domain.md against the post-plan-series API: hook phases, entry points, evaluator signature, `Decision` shape).

## 5. Coverage & CI guardrails

- Run `bun test --coverage`; set a floor (suggest 90% lines on `src/lib` and `src/core.ts`) in bunfig/CI so the pipeline fails on regressions.
- Add the review's two repro scenarios as named regression tests if not already present: `regression: dedupe-before-cache must not hang (H1)`, `regression: FeatureGate loading renders during suspension (H2)`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`, `bun run format -- --check`

## Release

- No changeset (test/docs only), per repo policy.
