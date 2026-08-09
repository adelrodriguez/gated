# b06 — Typed variant payloads

Fixes: A1. Depends on: —. Breaking at the type level (payload type parameter, `IdentityValue` no longer the payload type); runtime unchanged.

## Goal

Consumers read `details().payload` without casting, and the payload type stops borrowing the identity-value type.

## Problem

`Decision`'s variant arm types `payload?: IdentityValue` (src/lib/types.ts:21) and `EvaluationDetails` mirrors it (src/lib/types.ts:30). `IdentityValue` does triple duty — identity attribute values, variant payloads, and `normalizeError` input — so the name misleads and the effective type is `unknown`-with-extra-steps: every `details.payload` read requires a cast, and nothing ties a gate's payload shape to its provider adapter.

## Design

1. Introduce `type UnknownPayload = unknown` semantics without the ceremony: `Decision` becomes generic, `Decision<TPayload = unknown>`, with the variant arm carrying `payload?: TPayload`. The non-generic `Decision` remains valid everywhere it appears today (hooks, recipes, `decide` return types) via the default.
2. Gates declare their payload type at creation, defaulting to `unknown`:

```ts
const theme = gate({
  key: "theme",
  defaultValue: "light",
  variants: ["light", "dark"],
}) // EvaluationDetails<..., unknown>

const themed = gate<{ experiment: string }>({ ... }) // details().payload: { experiment: string } | undefined
```

Concretely: the variant overload of `gate()` gains an optional `TPayload` parameter threaded to `GateEvaluator<TIdentity, TValue, TPayload>` and `EvaluationDetails<TValue, TPayload>` (both defaulted so existing annotations compile). No runtime validation of payload shape — the declaration is a typing convenience, consistent with cache docs stating implementations own payload fidelity.

3. `decision.variant(variant, payload)` becomes generic in the payload; `normalizeError` switches its parameter from `IdentityValue` to `unknown` (it always was semantically unknown). `IdentityValue` remains exported and used only for identity attributes.

4. Boolean gates: `details().payload` is currently typed present-but-optional on all details. Tighten: payload is only on variant-gate details (`EvaluationDetails` conditional on value type or a second parameter defaulted to `never` for boolean gates), so boolean `details()` no longer advertises a field that can never exist.

## Changes

- `src/lib/types.ts` — generic `Decision`, `EvaluationDetails`, `GateEvaluator`; `IdentityValue` doc comment narrowed to identities.
- `src/lib/decision.ts` — generic `decision.variant`.
- `src/lib/internal.ts` — `normalizeError(error: unknown)`; update casts at call sites in `src/lib/index.ts`.
- `src/core.ts` — thread `TPayload` through the variant overload of `gate()` and `GateBatch['details']`.
- README — Evaluation Details and Provider Integration sections show the typed-payload declaration; LaunchDarkly example types its detail payload.

## Tests

- Type-level (`test/package-exports/consumer.ts`) — payload inferred as declared on `details()` and `batch.details()`; boolean-gate details reject `payload` access; untyped variant gates read `unknown`; existing annotations (`Decision`, `Hook`) compile without parameters.
- `src/__tests__/core.test.ts` — runtime behavior unchanged (payload passthrough on details, omission when absent) — existing tests should pass unmodified; add one asserting a declared-payload gate passes the payload through verbatim (no validation).

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`

## Release

- Changeset: minor (type-level breaking pre-1.0). "Variant payloads are typed: declare a payload type per gate and read `details().payload` without casting. `Decision`, `EvaluationDetails`, and `GateEvaluator` gain defaulted type parameters; boolean-gate details no longer expose `payload`."
