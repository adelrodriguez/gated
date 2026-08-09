# 12 — Batch evaluation

Delivers: API opportunity #7. Depends on: 03 (lifecycle), 08 (options object), 09 (signal plumbing), 11 (anonymous policy). Additive, non-breaking.

## Goal

Consumers evaluating many flags (SSR page render, app bootstrap) minimize provider round-trips. Individual gate semantics (hooks, validation, defaults, and details) are preserved per flag.

## Design

Optional batch decision function on the factory config, plus a batch API:

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

const batch = await gate.batch([betaAccess, theme])
batch.get(betaAccess) // boolean, sync, type-safe
batch.get(theme) // "light" | "dark", sync
batch.details(theme) // EvaluationDetails<"light" | "dark">, sync
```

- `gate.batch(flags, options?)`: resolves identity once, then runs each flag through its `before` and `resolve` phases. Hook-resolved flags complete without provider work. Ready unresolved keys are micro-batched through `decideMany` without waiting on dedupe followers (or sent to parallel `decide` calls when `decideMany` is absent), after which each flag resumes through shared validation/after/error/finally logic. Synchronous preparation normally produces one batch; asynchronous hooks can produce multiple batches. Per-flag failure produces that flag's default.
- Implementation route: split plan 03's internals into reusable `prepareEvaluation` and `completeEvaluation` phases around the same evaluation record — do NOT build a second evaluation pipeline.
- Initially require unique flag keys within one batch and validate that invariant before identity resolution, hooks, or provider work. Throw a descriptive runtime error for duplicates. This avoids ambiguous defaults and variants.
- Dispatch each micro-batch as soon as its leaders finish preparation. It must not wait for every flag, because a dedupe follower can depend on a leader in another concurrent batch.
- `batch.get` and `batch.details` are synchronous and only accept flags that were in the batch (type the batch over the tuple of evaluators; either method throws for a missing flag).
- Missing key in `decideMany` response → that flag falls back to its single `decide`, then default. Extra keys ignored.
- Anonymous batches pass `null` to `decideMany`; cache and dedupe hooks bypass those evaluations exactly as they do on the single-gate path.

## Changes

- `src/lib/types.ts` — `decideMany?: (keys: readonly string[], identity, opts?: { signal? }) => MaybePromise<Record<string, Decision>>`.
- `src/core.ts` — attach `batch` to the gate factory; type it over the evaluator array.
- `src/lib/index.ts` — batch orchestration reusing `executeGate` internals.
- README — "Batch evaluation" section with an SSR example.

## Tests

- Synchronously prepared unresolved keys are sent together; `decide` is not called for keys returned by a batch.
- A cache hit resolves during preparation and its key is omitted from `decideMany`.
- Per-flag hooks all fire (before/resolve/after/finally) for each flag in the batch.
- One flag's decision invalid (bad variant) → that flag gets its default; others unaffected.
- Missing key in the batch response → single `decide` fallback for that flag only.
- No `decideMany` configured → N parallel `decide` calls, identical results.
- `batch.get` type inference: boolean vs variant flags (compile-time assertions).
- `batch.details` preserves source, default errors, and variant payloads with typed values.
- Concurrent batches with cross-key dedupe leaders do not hang when hook latencies differ.
- Anonymous batches pass null identity to each batch and are not deduplicated.
- Batch + `dedupeHook`/`cacheHook` integration: cache populated per flag.
- Duplicate flag keys fail before provider work with a descriptive error.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `decideMany` and `gate.batch()` for typed batch evaluation with full per-flag lifecycle semantics."
