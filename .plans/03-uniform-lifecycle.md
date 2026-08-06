# 03 — Uniform lifecycle + internal evaluation record

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
2. Obtain decision from resolve hooks (`source: "hook"`) or provider (`source: "provider"`)
3. **Validate the decision immediately** — variant-in-list AND boolean/variant type match (merge `validateVariant` + the `expectedType` check from `extractDecisionValue` into one `validateDecision(decision, options)` step). Invalid decision → throw before any after hook sees it. (Fixes H4.)
4. **Run after hooks for every validated decision**, regardless of source, passing the source: `after(context, decision, meta: { source: "hook" | "provider" })`. (Fixes H1's root cause.)
5. Extract value, return. On any error: error hooks → default. Finally hooks always.

`Hook.after` signature gains an optional third parameter (additive, non-breaking for existing hooks).

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

- `cacheHook.after` — skip writes when `meta.source === "hook"` (don't re-cache cache hits or other hooks' resolutions).
- `dedupeHook` — with after hooks now always running, the primary settle path works in any ordering. Add a `finally` backstop: if a pending entry for the key still exists, reject it with a descriptive error and delete it, so no contract violation can ever orphan followers again.
- Document hook ordering guidance in README's recipes section (ordering now affects efficiency, not correctness — state that explicitly).

## Tests

New integration suite `src/__tests__/lifecycle.test.ts` running `buildGate` end-to-end with real recipes (this is the seam the review found untested):

- **Regression (H1):** `[dedupeHook(), cacheHook(cache)]` — three sequential calls resolve; third call must not hang (guard with a timeout race).
- Same suite with `[cacheHook(cache), dedupeHook()]` — both orderings correct.
- Concurrent calls with dedupe: provider called once; all callers get the value; error case rejects all followers and the next call starts fresh.
- After hooks fire on hook-resolved decisions with `source: "hook"`, and on provider decisions with `source: "provider"`.
- Cache is NOT rewritten on a cache hit (`cache.set` not called when resolve hook supplied the decision).
- **Regression (H4):** resolve hook returns `{ value: true }` for a variant gate → after hooks never see the invalid decision, `cache.set` not called, gate returns default.
- Provider returns out-of-list variant → same: no after hooks, default returned.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- Manually run the review's repro script shape against the new build.

## Release

- Changeset: minor. "After hooks now run for hook-resolved decisions (with a decision source tag), decisions are validated before after hooks observe them, and `dedupeHook` can no longer orphan pending requests. Fixes a permanent hang when `dedupeHook` was ordered before `cacheHook`."
