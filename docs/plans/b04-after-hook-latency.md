# b04 — After-hook latency policy

Fixes: F7. Depends on: —. Behavioral change: `after` hooks leave the hot path (decision below); the returned value is available before after-hooks settle.

## Goal

A slow observer (analytics, cache write) does not delay the flag value. The policy for when after-work is awaited is explicit, documented, and uniform.

## Problem

`runAfterHooks` is awaited before `executeGateDetails` returns (src/lib/index.ts:494). With the documented Redis cache, every provider-sourced evaluation pays a full network write before the caller sees its boolean. The deadline also covers after-hooks, so a slow cache write can convert a good decision into a timeout default (the README documents the `finally`-only exception, but `after` sits inside the operational window).

## Decision to make (start of plan, not end)

Two viable designs; pick one before implementation:

1. **Fire-and-forget after hooks (recommended).** `after` becomes observational like `finally`: the decision is committed first, after-hooks run detached, failures still report to `onHookError`. Dedupe must then settle followers at commit time, not in `after` — which b07/w11 machinery makes natural, but in this plan the dedupe recipe simply settles from a detached after-hook (followers already tolerate late settlement; the `finally` backstop remains).
2. **Per-hook opt-in (`after` stays blocking; hooks may declare `{ blocking: false }`).** Preserves current semantics for hooks that need read-your-write consistency (a cache warming before a follower's resolve), at the cost of a wider Hook type.

Recommendation: option 1. The only in-repo consumer needing ordering is dedupe, and its correctness derives from settle-on-commit, not from blocking the caller. Read-your-write cache consistency across _sequential_ evaluations is not guaranteed today anyway (async cache backends), so option 1 formalizes reality.

## Design (assuming option 1)

- Commit the decision (extract value, fix `details` fields) immediately after validation; run `runAfterHooks` detached with rejection reporting, outside `raceWithSignal` (a caller abort no longer cancels observation — align with the `finally` wording).
- The evaluation deadline now covers identity → resolve → provider → validation. `after`, `error`, and `finally` hooks are observational; the "if only `finally` teardown exceeds it, the decision is preserved" README sentence generalizes to all post-commit phases.
- Ordering guarantee kept: `after` hooks still all start before `finally` hooks for the same evaluation (chain the detached tasks), so recipes relying on `after`-then-`finally` sequencing keep working.
- Batch: unchanged — batch settlement waits on `executeGateDetails`, which now resolves at commit; entry cleanup moves accordingly.

## Changes

- `src/lib/index.ts` — restructure the post-validation tail of `executeGateDetails`; keep `error`-path semantics (error hooks stay pre-return so `details()` callers observe a settled error state — they are on the failure path where latency is not the concern).
- `src/hooks/recipes.ts` — confirm dedupe settles correctly from detached `after` (owner check unchanged); adjust comments.
- README — Hook System and Timeouts sections rewritten for the new lifecycle window; changelog-worthy migration note for consumers relying on after-hooks completing before the promise resolves.

## Tests

- `src/__tests__/lifecycle.test.ts` — value resolves while a deliberately slow `after` hook is still pending; the after hook still runs and its failure still reports to `onHookError`. A slow after hook no longer triggers `GateTimeoutError` (regression pair against current behavior). Lifecycle-order test updated: after/finally still ordered relative to each other.
- Dedupe integration: followers settle when the leader's detached after hook fires; hostile-hook fuzz suite re-run unchanged.
- Batch: `gate.batch` resolves without waiting for after hooks; `decideMany` abort-on-return semantics unchanged.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "`after` hooks no longer block evaluation: the decision commits first and observers run detached (failures still report to `onHookError`). Slow cache writes no longer add latency or consume the evaluation deadline."
