# b11 — Core coalescing spike (dedupe in core)

Fixes: W3 (decision). Depends on: b07, b10. Outcome: a go/no-go decision document, then (if go) an implementation plan appended here. Do not start implementation before the spike concludes.

## Goal

Decide, with a working prototype, whether request coalescing should be a first-class `buildGate` option instead of the `dedupeHook` recipe — and either commit to the migration or write down why the recipe stays.

## Problem

Dedupe-as-hook works but only via three backstops spread across `recipes.ts` and `internal.ts`: the owner token (now b07's state marker), the `finally` rejection (`DedupeOwnerFinalizationError`), and the internal-error laundering channel (`HookResolutionAbortError`, special-cased in `runResolveHooks` and carved out of the hook-error reporting policy — README policy point 3). That is a lot of machinery for "don't call the provider twice", it reserves an internal exception pathway other hooks cannot use safely, and F8 showed it still has tolerated nondeterminism under abort.

## Spike questions

1. **Shape.** `buildGate({ coalesce: true })` (boolean, keyed by the b01 default key) vs `coalesce: { key?: RecipeKeyFn }`. Where does it sit in the lifecycle — around the provider call only (after resolve hooks, so cache hits never create pending entries: today's "ordering affects efficiency" note disappears) is the hypothesis to validate.
2. **Semantics under failure.** Leader failure propagates to followers as the leader's error (today's behavior) — confirm followers' error hooks and `onFallback` reports fire per-follower with the shared error.
3. **Abort.** A follower abort must not cancel the leader (today's guarantee); a leader abort should promote-or-reject followers deterministically — the exact fix for F8's race, which the hook contract cannot express but core can (settle followers at commit, before detached after hooks).
4. **Batch interplay.** Core coalescing must compose with `decideMany` grouping without deadlocks — replicate the existing "concurrent batches with cross-key dedupe leaders" test against the prototype.
5. **What dies.** If adopted: `HookResolutionAbortError`, `DedupeOwnerFinalizationError`, README hook-error policy point 3, and the dedupe recipe (deprecated with a release of overlap, since removing a documented export is breaking).

## Deliverables

- Prototype branch implementing coalescing around the provider call in `evaluate.ts`/`batch.ts` (post-b10 layout), passing the existing dedupe recipe test suite retargeted at the option.
- A decision section appended to this file: go/no-go, benchmark note (allocation/latency of the pending-map path vs recipe path), and — on go — the migration/deprecation schedule; on no-go, the specific reason (e.g. batch interplay complexity) recorded so the question is not relitigated.

## Verification (spike)

- Retargeted dedupe + batch suites green on the prototype; hostile-hook fuzz suite green with coalescing enabled and no dedupe recipe registered.

## Release

- None from the spike itself. Implementation (if go) ships under its own changeset: minor, with the recipe deprecation note.
