# b05 — Anonymous per-call override

Fixes: F6. Depends on: —. Additive.

## Goal

In `anonymous: "allow"` mode, a caller can force a specific evaluation to run anonymously, the same way it can force a specific identity.

## Problem

`identify()` (src/lib/index.ts:109) treats a `null` override identically to "not provided" (`overrideIdentity !== undefined && overrideIdentity !== null`), and `GateCallOptions.identity` is typed `TIdentity | undefined`, so `{ identity: null }` is both a type error and a runtime no-op — `config.identify()` runs anyway. There is no way to say "evaluate this call as anonymous" when `identify` would resolve a user (e.g. previewing the logged-out experience, or a server endpoint serving both audiences).

## Design

- Widen the call-options type only for anonymous factories. `GateFactory` produced by the `AnonymousGatedConfig` overload yields evaluators whose options accept `identity?: TIdentity | null`; strict factories keep `TIdentity`. This needs the factory type to carry the anonymous mode — add a second type parameter with a default (`GateFactory<TIdentity, TCallIdentity = TIdentity>`) threaded through `GateEvaluator` and `batch`, so strict-mode consumers see no change.
- Runtime: `identify(fn, overrideIdentity, allowAnonymous)` distinguishes `undefined` (absent → call `fn`) from `null` (explicit anonymous). `null` with `allowAnonymous: false` throws `IdentityNotFoundError` — same outcome as `identify` returning null in strict mode, so strict semantics are unchanged even for untyped callers.
- Recipes already bypass `!context.identity`; an explicit-anonymous call therefore skips cache/dedupe exactly like a resolved-null identity. Batch: `{ identity: null }` in `gate.batch` options short-circuits identity resolution to `null` under the same rule.

## Changes

- `src/lib/index.ts` — `identify` distinguishes `undefined` from `null`; batch identity resolution passes the override through unchanged.
- `src/lib/types.ts` / `src/core.ts` — `GateCallOptions` gains the nullable form via the factory's call-identity parameter; overloads on `buildGate` select it.
- README — Anonymous Evaluation section: document `{ identity: null }` as an explicit anonymous evaluation, note the strict-mode behavior (throws → default, reported via `details().error`).

## Tests

- `src/__tests__/lifecycle.test.ts` — anonymous mode: `{ identity: null }` skips `identify` (spy not called), passes `null` to `decide`, `details()` reports `source: "provider"`. Strict mode: `{ identity: null }` returns the default with `IdentityNotFoundError` and never calls `identify` or `decide`.
- `src/__tests__/batch.test.ts` — batch with `{ identity: null }` in anonymous mode resolves once with `null` and passes `null` to `decideMany`.
- Type-level (`test/package-exports/consumer.ts`) — `{ identity: null }` compiles against an anonymous factory's evaluators and is a type error against a strict factory's.

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Anonymous-mode gates accept `{ identity: null }` to force an anonymous evaluation for a single call or batch."
