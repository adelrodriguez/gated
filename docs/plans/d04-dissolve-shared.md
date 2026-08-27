# d04 — Dissolve `shared.ts` into a gate-shape module

Status: **exploration** — the split direction is settled, but naming and the destination of `getEvaluationKey` should be decided in review; see the open questions. From the 2026-08-10 architecture review (revised 2026-08-14 — #84 already resolved the original candidate's hardest part: the evaluation key is now derived once, from one `config.evaluationKey` projection, so this plan is down to module placement). Depends on: — (d01 landed first; it narrowed `AnyGatedConfig` to three readers but did not remove it, so d04 owns the type's destination). Behavioral change: none.

## Goal

`src/lib/evaluation/shared.ts` no longer exists. A gate-shape module owns `GateOptions`, its runtime validation, and the boolean/variant discrimination. Adding a gate option edits one module.

## Problem

- `shared.ts` (47 lines) exports five things with no shared concept: `AnyGatedConfig`, `GateOptions`, `GateConfiguration`, `getGateConfiguration`, `getEvaluationKey`. The name describes its dependency graph ("things two files both needed"), not a module.
- `GateOptions` (shared.ts:14-19) is declared here, but its invariants are enforced elsewhere: `assertGateOptions`/`assertTimeoutMs`/`MAX_TIMER_DELAY_MS` occupy src/factory.ts:43-101 (~23% of the file). Adding a gate option means editing shared.ts (type), factory.ts (assert + two `gate` overloads + two `GateFactory` call signatures), and engine.ts. The change does not concentrate.
- `getGateConfiguration` (shared.ts:25-27) is a one-line ternary whose callers already hold `options.variants`.
- `getEvaluationKey` (shared.ts:29-47) defines the collision-safe **evaluation key** — a first-class domain term — but lives in a grab-bag. (Its former double-derivation problem is gone: resolve.ts:248 derives it once.)

Deletion test: deleting `shared.ts` concentrates — the gate shape folds together with its validation. That is the signal to act on.

## Design sketch

- `src/lib/evaluation/gate-shape.ts` (name open) — `GateOptions`, `GateConfiguration`, `getGateConfiguration` (or inline it), plus the validation moved out of factory.ts. One module to edit per new gate option; factory.ts shrinks by a quarter.
- `getEvaluationKey` — either its own `evaluation-key.ts` (the domain term earns a module) or a move into resolve.ts, its only remaining caller. Leaning to `evaluation-key.ts`: resolve.ts is about the resolution protocol, not the key encoding, and the key is also the domain doc's vocabulary entry.
- `AnyGatedConfig` — survived d01 with exactly three readers: `resolveConfig`'s parameter (src/lib/evaluation/resolved-config.ts) and the fixture helpers in `engine.test.ts` and `resolve.test.ts`. It is the config union at the `buildGate` boundary, not part of the gate shape, so it moves next to `ResolvedConfig` in resolved-config.ts rather than into either new module.

## Open questions (must close before implementation)

1. **Naming.** `gate-shape.ts` vs `gate-options.ts`. Pick in review.
2. **`getEvaluationKey` destination.** Own module vs resolve.ts (see above). Pick in review.
3. **Does `getGateConfiguration` survive?** Two callers, one-line body; inlining removes an export but duplicates the ternary. Either is fine; decide by taste in review.

## Changes (once questions close)

- `src/lib/evaluation/gate-shape.ts` (+ optionally `evaluation-key.ts`) — new, as above.
- `src/lib/evaluation/shared.ts` — deleted; imports across engine.ts, batch.ts, resolve.ts, decision.ts, identity.ts (if pre-d01), factory.ts, and the registry repointed.
- `src/factory.ts` — validation moves out.

## Tests

- Move the `assertGateOptions` cases (currently in core.test.ts, "rejects invalid $field gate options") next to the gate-shape module, or keep them where they are — they already cover every rejection branch; do not lose the timeout-bounds cases.
- New `evaluation-key` tests if it gets its own module: default encoding (flag key, kind, variants, `typeof distinctId`, stringified id), anonymous → `undefined`, custom projection.
- Everything else must pass unchanged — this is a move, not a behavior change.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: none (internal move).
