# b02 — Runtime gate-option validation and evaluation hardening

Fixes: F3, F5, F9. Depends on: —. Behavioral change: previously accepted invalid configurations now throw at gate creation.

## Goal

The fallback value can never violate the gate's own contract, misconfiguration fails at creation time (not silently at evaluation time), and small internal hardening removes two footguns.

## Problem

- **F3.** `gate({ key: "theme", defaultValue: "purple", variants: ["light", "dark"] })` is accepted at runtime; on any fallback the gate returns `"purple"`, a value outside the declared variant set that `validateDecision` (src/lib/index.ts:330) would reject from any provider or hook. Empty `key`, empty `variants`, and duplicate variant entries are also unchecked. TypeScript catches these for TS consumers only.
- **F5.** `gate.batch([])` resolves identity (src/lib/index.ts:565 onward) before discovering there is nothing to evaluate — a wasted, potentially side-effectful round trip.
- **F9.** `executeGateDetails` captures `config.hooks` by reference (src/lib/index.ts:379); a consumer mutating the array mid-evaluation changes phase membership between phases and skews `hookIndex` in `HookErrorReport`.

## Design

Validation lives in the `gate()` factory (src/core.ts:117), beside `assertTimeoutMs`, so every evaluator is valid by construction:

- `key` must be a non-empty string.
- When `variants` is present: it must be a non-empty array of unique strings, and `defaultValue` must be one of them.
- When `variants` is absent: `defaultValue` must be a boolean.

Throw `RangeError`/`TypeError` consistent with `assertTimeoutMs` style (plain built-ins, not `GatedError` — these are programmer errors, not evaluation failures, and must not be catchable as gate fallbacks).

For F5, `gate.batch([])`/`executeGateBatch` with zero entries short-circuits to an empty batch without calling `identify` — `get`/`details` on it still throw `BatchFlagNotFoundError` as today.

For F9, snapshot hooks once per evaluation: `const hooks = [...(config.hooks ?? [])]` in `executeGateDetails`. Document in the Hook System section that the hook list is fixed when evaluation begins.

## Changes

- `src/core.ts` — add `assertGateOptions(options)` invoked in `gate()`; keep messages specific (name the offending field and value).
- `src/lib/index.ts` — empty-entries early return in `executeGateBatch`; hooks array snapshot in `executeGateDetails`.
- README — Variant Flags section: note that `defaultValue` must be a member of `variants` and this is enforced at runtime; Batch section: `gate.batch([])` performs no identity or provider work.

## Tests

- `src/__tests__/core.test.ts` — creation-time rejections: out-of-list `defaultValue`, empty `key`, empty `variants`, duplicate variants, non-boolean `defaultValue` without `variants`. Each asserts the error names the field. Valid configurations (including single-variant arrays) still construct.
- `src/__tests__/batch.test.ts` — `gate.batch([])` resolves without invoking `identify` (spy) and returns a batch whose `get` throws `BatchFlagNotFoundError`.
- `src/__tests__/lifecycle.test.ts` — a `before` hook that pushes a new hook into `config.hooks` mid-evaluation: the appended hook does not run in any phase of the current evaluation and `hookIndex` reporting is stable; it does run on the next evaluation.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Gate creation validates options at runtime: variant `defaultValue` must be a declared variant, `key` non-empty, `variants` non-empty and unique. `gate.batch([])` no longer resolves identity. The hook list is snapshotted when an evaluation begins."
