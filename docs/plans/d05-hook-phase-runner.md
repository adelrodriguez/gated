# d05 — One hook-phase runner, detached by construction

Status: **exploration** — the interface shape (single generic runner vs per-evaluation runner object) needs a decision, and the engine's error-path nuances must be mapped before implementation; see the open questions. From the 2026-08-10 architecture review (revised 2026-08-14 — unchanged in substance; only line references moved). Depends on: —. Behavioral change: none; hook ordering, error reporting, and detachment semantics are pinned by lifecycle.test.ts.

## Goal

`src/lib/hook.ts` presents one interface for running a hook phase. The "post-commit hooks are fire-and-forget" invariant is enforced by that module's types, not by the engine remembering to call `consumeCleanup` at four separate sites. Adding a fifth hook phase is one edit.

## Problem

- `hook.ts:46-93` exports four functions — `runBeforeHooks`, `runAfterHooks`, `runErrorHooks`, `runFinallyHooks` — with identical bodies modulo which optional handler is invoked and which phase string goes into the `HookErrorReport`. ~12 lines of distinct behavior behind 4 signatures. A fifth phase means a fifth export, a fifth import in engine.ts, and a fifth call site — the change does not concentrate.
- `consumeCleanup` (signals.ts:74-76) is `void promise.catch(() => null)` — a named _convention_, not a behavior. The invariant it encodes (detached hook phases must not surface rejections) is re-asserted at four engine call sites (engine.ts:162, 170, 175, 180); forgetting one produces an unhandled rejection. Nothing in the type system enforces it.
- In practice the `run*Hooks` functions never reject (`Promise.allSettled` + background reporting), which makes the defensive `consumeCleanup` calls doubly confusing: the reader must prove to themselves whether the catch is load-bearing.
- Minor, same module family: `noop` and `abortReason` are exported from signals.ts (:4, :6) but used only inside it.

## Design sketch

Direction A — single generic runner:

```ts
type HookPhaseArgs = {
  before: []
  after: [decision: Decision, meta: { source: "cache" | "provider" }]
  error: [error: Error]
  finally: []
}

// Detached: settles internally, reports via onHookError, never rejects. Returns void.
export function dispatchHookPhase<P extends keyof HookPhaseArgs>(
  phase: P,
  hooks,
  context,
  reporter,
  ...args: HookPhaseArgs[P]
): void
// Awaitable variant for the phases the engine actually awaits.
export function runHookPhase<P extends keyof HookPhaseArgs>(...same): Promise<void>
```

Direction B — per-evaluation runner object, constructed once in the engine:

```ts
const hookRunner = createHookRunner(hooks, hookContext, config.onHookError)
await hookRunner.before()
hookRunner.dispatchAfterThenFinally(decision, meta) // detached chain; engine.ts:155-162 collapses
hookRunner.error(gateError) // awaitable; .dispatchError() for the aborted path
```

B closes over the three arguments every call repeats (hooks, context, reporter), so engine call sites shrink to their phase-specific payload — deeper for the engine, at the cost of a small object per evaluation.

Either way: the phase discriminant drives both dispatch and the `HookErrorReport["phase"]` field (already exactly this union in types.ts); `consumeCleanup` is deleted; `noop`/`abortReason` become module-private.

## Open questions (must close before implementation)

1. **A or B.** Recommendation: B — the engine makes seven hook-related calls with the same first three arguments; a per-evaluation runner is the deeper interface and gives the after→finally chaining (engine.ts:155-161) a home. Evaluations already allocate context, signals, and promises, so the extra object is noise.
2. **The error-path split.** engine.ts:167-177 runs error hooks detached when the signal aborted, awaited (with a catch-to-detach fallback) otherwise. Map this into the new interface explicitly — it is the one place a phase is _conditionally_ detached, and the design must not paper over it. Recommendation: keep both spellings (`error()` awaitable, `dispatchError()` detached) and let the engine keep the branch; the invariant that neither rejects unhandled moves into hook.ts.

## Changes (once questions close)

- `src/lib/hook.ts` — one runner (A or B); delete the four `run*Hooks` exports; keep `reportInBackground` (it has non-hook callers: factory.ts, resolve.ts).
- `src/lib/evaluation/engine.ts` — call sites collapse; all four `consumeCleanup` uses deleted.
- `src/lib/evaluation/signals.ts` — delete `consumeCleanup`; un-export `noop` and `abortReason`.
- `src/lib/__tests__/hook.test.ts` — rewrite against the new interface.

## Tests

- lifecycle.test.ts is the behavioral pin — hook ordering (before → after → finally; error → finally), one stable context across phases, `onHookError` reports with correct `phase`/`hookIndex`, detached after/finally not blocking the returned value. Must pass unchanged.
- New in hook.test.ts: a rejecting hook in a detached phase produces no unhandled rejection — the invariant this refactor moves into the module, previously unassertable per call site.
- Type-level: detached methods return `void`, not `Promise<void>` — a future engine change cannot accidentally await or leak them.

## Verification

- `pnpm run test`, `pnpm run build`, `pnpm run check`, `pnpm run analyze`

## Release

- Changeset: none (internal; `gated/hooks` and hook observable behavior unchanged).
