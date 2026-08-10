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

## Decision — GO (2026-08-09)

The working prototype supports core request coalescing and is retained as the production
implementation. The option shape is `coalesce?: boolean | { key?: (context) => string }`.
Coalescing runs after resolve hooks and before provider ownership is reported to the batch
orchestrator. A hook decision therefore creates no pending entry. The default key uses the b01
collision-safe tuple of flag key, `distinctId` type, and `distinctId` value. Anonymous evaluations
are not coalesced. A custom projection receives the complete `HookContext`.

### Spike answers

1. **Shape and lifecycle:** Both `coalesce: true` and `coalesce: { key }` are supported. Provider
   work is the coalescing boundary. Resolve hooks always run for each evaluation before lookup.
2. **Failure:** The leader's normalized error rejects the shared pending decision. Each follower
   then takes its own error path, so error hooks and `onFallback` run once per evaluation with the
   same error object.
3. **Abort:** A follower races the shared decision with only its own signal and cannot cancel the
   leader. A leader abort deterministically rejects all followers with the leader's abort reason.
   Followers settle when the decision commits, before detached `after` hooks.
4. **Batch:** Coalescing ownership is selected before `onPrepared`. Leaders report `true` and enter
   `decideMany` grouping; followers report `false` and await the leader. The cross-key concurrent
   batch regression completes without deadlock and retains two `decideMany` calls. An earlier
   prototype that selected ownership after `onPrepared` made four calls; that design was rejected.
5. **Legacy machinery:** `dedupeHook` is deprecated now but remains for one major-version overlap
   window. `HookResolutionAbortError`, `DedupeOwnerFinalizationError`, the recipe, and its special
   hook-error behavior can be removed together in the next major release.

### Benchmark

The benchmark ran 5,000 sequential pairs of concurrent evaluations, five times per mode, with an
immediate async provider. Both modes made 5,000 provider calls. Median elapsed time was 112.15 ms
for core coalescing and 126.82 ms for `dedupeHook` (core was approximately 11.6% faster).

A separate five-process allocation sample ran 20,000 pairs. Median observed heap growth was about
2.10 MB for core coalescing and 2.33 MB for the recipe path (approximately 10% lower for core).
Both paths allocate one pending promise and map entry per leader; core avoids the recipe's
per-evaluation hook state and hook-runner work. These are local Bun 1.3.14 microbenchmarks and are
directional, not release performance guarantees.

### Migration schedule

- This minor release adds `coalesce`, documents it as the preferred API, and deprecates
  `dedupeHook`. Existing recipe consumers do not change behavior.
- The recipe and core option overlap for the remainder of this major release. Consumers with a
  custom recipe key move that projection to `coalesce.key`.
- The next major release removes `dedupeHook` and its internal control-error channel, then removes
  the legacy hook-error-policy exception.
