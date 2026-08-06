# 04 — Hook error policy

Fixes: H5. Delivers: arch win #3. Depends on: 03. Behavioral change (new observability, same fallback semantics).

## Goal

Hook failures never abort evaluation, but they are always observable. One documented policy for every phase.

## Problem

- `before`/`after`/`error`/`finally` rejections vanish inside `Promise.allSettled` (src/lib/index.ts:58-60, 92-93, 101-102, 109-110).
- `resolve` failures vanish in an empty `catch` (src/lib/index.ts:79-81).
- A permanently failing cache (or analytics hook) degrades silently forever.

## Design

Add an optional reporter to `GatedConfig`:

```ts
type HookErrorReport<TIdentity extends Identity> = {
  phase: "before" | "resolve" | "after" | "error" | "finally"
  hookIndex: number
  error: unknown
  context: HookContext<TIdentity>
}

type GatedConfig<TIdentity> = {
  // ...existing
  onHookError?: (report: HookErrorReport<TIdentity>) => void
}
```

Policy (document verbatim in README):

1. A failing hook never aborts evaluation and never changes the returned value.
2. Every hook failure in every phase is reported to `onHookError` (fire-and-forget; a throwing `onHookError` is swallowed — it is the end of the line).
3. `error` hooks report _gate_ failures (identity/provider/validation); `onHookError` reports _hook_ failures. They do not overlap.

Deliberately NOT routing hook failures into `error` hooks: that would recurse (a failing error hook reporting to error hooks) and conflates two distinct failure domains.

## Changes

- `src/lib/index.ts` — the `runXHooks` helpers take the reporter; inspect `allSettled` results and report rejections with phase + index; `runResolveHooks` replaces its empty catch with a report-and-continue.
- `src/lib/types.ts` — add `HookErrorReport`, extend `GatedConfig`.
- `src/index.ts` — export `HookErrorReport` type.
- README — new "Hook error handling" subsection under Hook System stating the policy.

## Tests

Extend `src/__tests__/lifecycle.test.ts` with hostile hooks (the review's missing "hostile-hook tests"):

- A hook that throws in each phase (five cases): evaluation still returns the provider value; `onHookError` receives correct `phase` and `hookIndex`.
- Throwing resolve hook: later resolve hooks still run; provider still consulted.
- Throwing `error` hook during a genuine gate failure: default still returned; `onHookError` reports it.
- Throwing `onHookError` itself: evaluation unaffected.
- No `onHookError` configured: everything still works silently (current behavior preserved).

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `onHookError` to `GatedConfig`; hook failures in every lifecycle phase are now reported instead of silently swallowed."
