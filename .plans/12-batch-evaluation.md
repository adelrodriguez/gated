# 12 — Batch evaluation / snapshots

Delivers: API opportunity #7. Depends on: 03 (lifecycle), 08 (options object), 09 (signal plumbing), 11 (anonymous policy). Additive, non-breaking.

## Goal

Consumers evaluating many flags (SSR page render, app bootstrap) make one provider round-trip instead of N. Individual gate semantics (hooks, validation, defaults) are preserved per flag.

## Design

Optional batch decision function on the factory config, plus a snapshot API:

```ts
const gate = buildGate({
  identify,
  decide, // still required — single-flag path
  decideMany: async (keys, identity) =>
    // optional batch path
    provider.evaluateAll(keys, identity), // Record<string, Decision>
})

const betaAccess = gate({ key: "beta-access", defaultValue: false })
const theme = gate({ key: "theme", defaultValue: "light", variants: ["light", "dark"] })

const snapshot = await gate.snapshot([betaAccess, theme])
snapshot.get(betaAccess) // boolean, sync, type-safe
snapshot.get(theme) // "light" | "dark", sync
```

- `gate.snapshot(flags, options?)`: resolves identity once, then runs each flag through its `before` and `resolve` phases. Hook-resolved flags complete without provider work. Only unique unresolved keys are sent to one `decideMany` call (or parallel `decide` calls when `decideMany` is absent), after which each flag resumes through shared validation/after/error/finally logic. Per-flag failure produces that flag's default.
- Implementation route: split plan 03's internals into reusable `prepareEvaluation` and `completeEvaluation` phases around the same evaluation record — do NOT build a second evaluation pipeline.
- Initially require unique flag keys within one snapshot and validate that invariant before identity resolution, hooks, or provider work. Throw a descriptive runtime error for duplicates. This avoids ambiguous defaults/variants and prevents a dedupe follower from waiting on a leader whose provider stage cannot start until preparation completes.
- `snapshot.get` is sync and only accepts flags that were in the snapshot (type the snapshot over the tuple of evaluators; `get` on a missing flag throws in dev).
- Missing key in `decideMany` response → that flag falls back to its single `decide`, then default. Extra keys ignored.

## Changes

- `src/lib/types.ts` — `decideMany?: (keys: readonly string[], identity, opts?: { signal? }) => MaybePromise<Record<string, Decision>>`.
- `src/core.ts` — attach `snapshot` to the gate factory; type it over the evaluator array.
- `src/lib/index.ts` — batch orchestration reusing `executeGate` internals.
- README — "Batch evaluation" section with an SSR example.

## Tests

- `decideMany` called exactly once with only unresolved unique keys; `decide` not called for keys returned by the batch.
- A cache hit resolves during preparation and its key is omitted from `decideMany`.
- Per-flag hooks all fire (before/resolve/after/finally) for each flag in the snapshot.
- One flag's decision invalid (bad variant) → that flag gets its default; others unaffected.
- Missing key in the batch response → single `decide` fallback for that flag only.
- No `decideMany` configured → N parallel `decide` calls, identical results.
- `snapshot.get` type inference: boolean vs variant flags (compile-time assertions).
- Snapshot + `dedupeHook`/`cacheHook` integration: no hangs, cache populated per flag.
- Duplicate flag keys fail before provider work with a descriptive error.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `decideMany` and `gate.snapshot()` for single-round-trip batch evaluation with full per-flag lifecycle semantics."
