# 07 — Evaluation details API

Fixes: H6. Delivers: API opportunity #1 (OpenFeature-style details). Depends on: 03 (evaluation record). Additive, non-breaking.

## Goal

Callers can distinguish "flag is off" from "system is down" without complicating the happy path. `await flag()` stays exactly as is.

## Design

The evaluator returned by the gate factory gains a `details` method:

```ts
const betaAccess = gate({ key: "beta-access", defaultValue: false })

await betaAccess() // boolean — unchanged
await betaAccess.details() // EvaluationDetails<boolean>
```

```ts
export type EvaluationDetails<TValue> = {
  value: TValue
  source: "hook" | "provider" | "default"
  /** Present when source is "default" because of a failure */
  error?: unknown
  flagKey: string
}
```

- `details()` accepts the same optional identity argument as the plain call.
- `source: "default"` covers both failures (with `error`) and — after plan 11 — any other default path; `error` presence is the failure discriminant.
- `details()` never rejects, same contract as the plain call.

## Changes

- `src/lib/index.ts` — `executeGate` already builds the evaluation record (plan 03); add `executeGateDetails` (or make `executeGate` return the record and have `buildGate` unwrap `.value` for the plain call — prefer this: one code path).
- `src/core.ts` — the `Gate` interface's returned evaluator becomes a callable object: `Object.assign(evaluator, { details })`. Update the exported evaluator type from plan 01. Type it the way zustand types `UseBoundStore` (`.packref/.../zustand/5.0.14/src/react.ts:39-42`): a named type that is an intersection of call signatures and the attached members — e.g. `type GateEvaluator<TIdentity, TValue> = { (overrideIdentity?: TIdentity): Promise<TValue> } & { details: (overrideIdentity?: TIdentity) => Promise<EvaluationDetails<TValue>> }` — rather than an anonymous `Object.assign` inference, so the shape survives in the public d.ts and matches plan 05's `ReactGate` convention.
- `src/index.ts` — export `EvaluationDetails`.
- README — "Evaluation details" section with the off-vs-down example (alerting when `error` is present).

## Tests

- `details()` returns `source: "provider"` on normal evaluation; value matches plain call.
- Resolve-hook decision → `source: "hook"`.
- Provider throws → `source: "default"`, `error` populated, `value` is the default.
- Identity missing → `source: "default"` with the identity error.
- Variant gate: `value` type inference preserved (`"light" | "dark" | "system"`).
- Plain call behavior byte-for-byte unchanged (existing core tests keep passing untouched).

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Gates expose `flag.details()` returning the evaluated value with its source (`hook` / `provider` / `default`) and the underlying error when evaluation fell back to the default."
