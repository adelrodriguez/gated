# 03 — Uniform lifecycle + internal evaluation record

**Status: Completed**

Fixes: H1 (dedupe hang), H4 (cache poisoning). Delivers: arch wins #1 (uniform lifecycle), #2 (evaluation record), #5 (dedupe hardening). Depends on: 02. Behavioral change (pre-1.0 acceptable).

This is the keystone slice — plans 04, 06, 07, 10, 11, 12 build on it.

## Goal

The hook lifecycle behaves identically regardless of where a decision comes from. Hook ordering becomes a performance concern, never a correctness trap. Repro from the review report (dedupe → cache ordering) passes.

## Contract changes

Current flow (src/lib/index.ts:142-166):

1. identify → before hooks → resolve hooks
2. If a resolve hook returns a decision: **return immediately** (skips validation-consistent ordering and after hooks; finally still runs)
3. Otherwise: decide → validate variant → **after hooks → validate type (too late)** → return

New flow:

1. identify → before hooks → resolve hooks
2. Treat `null` and `undefined` resolve results as misses. Validate each decision immediately; treat an invalid hook decision like a failed resolver and continue to later hooks or the provider so stale cache entries cannot force perpetual defaults.
3. Obtain a valid decision from a resolve hook (`source: "hook"`, with the exact resolver) or provider (`source: "provider"`).
4. **Validate provider decisions immediately** — variant-in-list AND boolean/variant type match (merge `validateVariant` + the `expectedType` check from `extractDecisionValue` into one `validateDecision(decision, options)` step). Invalid provider decision → throw before any after hook sees it. (Fixes H4.)
5. **Run after hooks for every validated decision**, regardless of source, passing required `AfterHookMeta` that identifies either the provider or exact resolving hook. (Fixes H1's root cause and supports layered caches.)
6. Extract value, return. On any error: error hooks → default. Finally hooks always.

`Hook.after` gains a required third `AfterHookMeta` parameter. Existing hook implementations may continue to declare fewer parameters, while direct callers must provide source metadata.

## Internal evaluation record

Replace the loose locals in `executeGate` (`identity`, `result`, contexts rebuilt at lib/index.ts:161,163) with a single record threaded through the pipeline:

```ts
type Evaluation<TIdentity> = {
  key: string
  identity: TIdentity | null
  decision?: Decision
  source?: "hook" | "provider" | "default"
  error?: unknown
}
```

Build the hook context once from this record. Plan 07 exposes it publicly; keep it internal here.

## Recipe updates

- `cacheHook.after` — skip writes only when that cache hook resolved the decision. Decisions from another resolver warm the cache, enabling layered caches.
- `dedupeHook` — with after hooks now always running, the primary settle path works in any ordering. Mark every pending promise as rejection-handled when it is created so a leader failure with zero followers cannot produce an unhandled rejection; followers awaiting the original promise must still observe the rejection internally. Give each pending entry an owner token and add a `finally` backstop that rejects and deletes the entry only when the finalizing evaluation owns it. A follower timeout or cancellation must never settle the leader's entry.
- Export `HookResolutionAbortError` from `gated` and `gated/hooks` so third-party single-flight hooks can propagate a leader failure without allowing later resolve hooks or the provider to retry.
- Document hook ordering guidance in README's recipes section (ordering now affects efficiency, not correctness — state that explicitly).

## Tests

New integration suite `src/__tests__/lifecycle.test.ts` running `buildGate` end-to-end with real recipes (this is the seam the review found untested):

- **Regression (H1):** `[dedupeHook(), cacheHook(cache)]` — three sequential calls resolve; third call must not hang (guard with a timeout race).
- Same suite with `[cacheHook(cache), dedupeHook()]` — both orderings correct.
- Concurrent calls with dedupe: provider called once; all callers get the value; on provider error, the internal pending promise rejects to release followers while every public gate call returns its configured default, and the next call starts fresh.
- Provider error with no followers: gate returns its default and no `unhandledRejection` is emitted.
- A consumer-timed-out follower does not reject, delete, or otherwise corrupt the leader's pending entry; cover this through `buildGate` rather than direct recipe internals.
- After hooks fire on hook-resolved decisions with the exact resolver, and on provider decisions with `source: "provider"`.
- Cache is NOT rewritten on a cache hit (`cache.set` not called when resolve hook supplied the decision).
- **Regression (H4):** a stale or type-mismatched hook decision is discarded, the provider is consulted, and caches are refreshed with the valid provider decision.
- A cache returning `null` for a miss continues to the provider.
- A later cache hit warms an earlier cache without rewriting the resolving cache.
- Provider returns out-of-list variant → same: no after hooks, default returned.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- Manually run the review's repro script shape against the new build.

## Release

- Changeset: minor. "After hooks now run for hook-resolved decisions (with exact resolver metadata), invalid hook decisions fall through to later resolvers or the provider, decisions are validated before after hooks observe them, and `dedupeHook` can no longer orphan pending requests."
