# b10 — Engine module split and explicit batch seam

Fixes: W1, W2. Depends on: b02, b04, b05, b08 (the behavioral plans that touch `src/lib/index.ts` — land them first to avoid rebase churn). Pure refactor: no public API or behavior changes.

## Goal

`src/lib/index.ts` (725 lines) becomes four focused modules with self-describing names, and the batch↔evaluation contract becomes a named, documented type instead of an implicit call-site convention.

## Problem

- **W1.** One file holds signal/timeout plumbing (`createEvaluationSignal`, `raceWithSignal`), the five hook runners, the single-evaluation engine (`executeGateDetails`), and the batch orchestrator (`executeGateBatch`). Reviewing any one concern means scrolling past the other three; test failures point into a monolith. Naming compounds it: `core.ts` is the public factory but `lib/index.ts` is the actual core.
- **W2.** `ExecutionOverrides` (src/lib/index.ts:59) — `identityResult`, `onPrepared(providerRequired)`, `provider: () => request.promise` — encodes the batch protocol: `onPrepared` fires exactly once, before provider work, `false` on hook resolution or failure; the injected provider resolves from the flush loop. None of that is written down where the type is declared; the next batch feature will break it silently.

## Design

New layout under `src/lib/` (import graph is one-way, top to bottom):

| Module           | Contents                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `signals.ts`     | `createEvaluationSignal`, `raceWithSignal`, `abortReason`, `consumeCleanup`, `noop`                                                         |
| `hook-runner.ts` | `runBeforeHooks` … `runFinallyHooks`, `reportHookError`, `reportRejectedHooks`                                                              |
| `evaluate.ts`    | `Evaluation` record, hook-context construction, `validateDecision`, `executeGateDetails`, `executeGate`, `identify`, `extractDecisionValue` |
| `batch.ts`       | `executeGateBatch`, `DecisionRequest`, flush/scheduling machinery                                                                           |

- `lib/index.ts` remains as a barrel re-exporting the current names so `src/core.ts` and tests need only import-path-neutral changes; internal test imports (`src/lib/__tests__`) update to the concrete modules.
- Rename consideration for `src/core.ts` → `src/factory.ts`: **do it now or never** — it is internal (root `index.ts` re-exports), so it is free today and misleading forever otherwise. Update `src/index.ts` imports.
- Formalize the seam in `batch.ts`/`evaluate.ts`:

```ts
/**
 * Contract between the batch orchestrator and a single evaluation.
 * - `identityResult` replaces identity resolution entirely.
 * - `onPrepared(providerRequired)` fires exactly once per evaluation, before any provider
 *   work: `true` iff no resolve hook produced a decision; `false` on hook resolution or
 *   any pre-provider failure. The orchestrator uses it to build the decideMany key set.
 * - `provider` replaces the configured `decide`; the orchestrator settles it from the
 *   flush loop and it must never be invoked before `onPrepared(true)`.
 */
export type ExecutionOverrides<TIdentity extends Identity> = { ... }
```

Add a debug-cheap runtime assertion that `onPrepared` fires at most once (already tracked via `preparationReported` — hoist that flag into the contract's documentation).

- Extract the duplicated boolean/variant hook-context literals into one builder parameterized by kind, preserving the getter-over-`Evaluation` behavior and reference stability (b07's documented guarantee).

## Changes

- File moves/splits as above; no logic edits beyond the context-builder dedup.
- `knip.config.ts` / `bunup.config.ts` — confirm no entry-point or export-map changes are needed (all moves are under `src/lib/`, not public entry points).
- `docs/agents/domain.md` — update any file-path references.

## Tests

- No new behavior: full suite must pass unchanged, including `bun run check:exports` (public surface identical) and the hostile-hook fuzz suite.
- `src/lib/__tests__/*` import updates; add one test asserting the barrel re-exports the same functions as the concrete modules (guards against drift).

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`, `bun run analyze` (knip: no new unused exports)

## Release

- Changeset: patch. "Internal refactor: evaluation engine split into signals/hook-runner/evaluate/batch modules; batch↔evaluation contract documented. No public API changes."
