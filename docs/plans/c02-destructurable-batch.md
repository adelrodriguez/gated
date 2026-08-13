# c02 — Destructurable batch results

Fixes: D4. Depends on: —. Behavioral (batch result object shape changes).

## Goal

Batch results read as tuples in flag order, so the common case needs one
reference per flag:

```ts
const [beta, theme] = await gate.batch([betaAccess, themeGate])
```

`get()` and `details()` remain for heterogeneous or pass-around access.

## Problem

`gate.batch` returns `{ get, details }` (`src/factory.ts:240`). Every read
repeats the evaluator: `batch.get(betaAccess)`. For the dominant "evaluate a few
known flags" case this is ceremony, and it prevents the client batch hook (c05)
from offering the tuple shape consumers expect from modern hooks.

## Design

- `executeGateBatch` already returns a `Map` keyed by flag in entry order; the
  factory materializes values in the same order as the input tuple.
- Return `Object.assign(values, { get, details })` where `values` is the array
  of gate values in flag order.
- Type: extend `GateBatch<TFlags>` to
  `Readonly<{ [K in keyof TFlags]: GateValue<TFlags[K]> }> & { get, details }`.
  The existing `const TFlags` generic on `batch` (`src/factory.ts:221`) already
  preserves tuple positions, so per-position value types fall out.
- Iteration, spread, and destructuring work because the result is a real array.
  `.length`, index access, and `Array.isArray` reflect that; document it.
- Do not add a `values` property alias. One shape, no synonyms.

## Changes

- `src/factory.ts` — build the value tuple, `Object.assign`, widen the
  `GateBatch` return type.
- `src/lib/types.ts` (or wherever `GateBatch` lives) — the mapped-tuple type.
- README — batch examples rewritten to destructuring first, `get`/`details`
  second (`decideMany` section around line 216).
- CONTEXT.md — the batch sentence gains "synchronously readable, destructurable
  in flag order".
- domain.md — extend the **batch** vocabulary row with the tuple shape.

## Tests

Extend `src/__tests__/batch.test.ts`:

- Destructured values match `get()` for boolean and variant gates, in input
  order.
- Type-level (in `src/__tests__/entrypoints.types.ts`): position 0 of
  `await gate.batch([booleanGate, variantGate])` is `boolean`, position 1 is the
  variant union; `get`/`details` keep their existing inference.
- Spread and `Array.from` produce the value tuple.
- Existing `get`/`details` tests pass unchanged.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Batch results are now destructurable tuples in flag order;
  `get()` and `details()` are unchanged. Code that introspected the batch object
  shape (for example `Object.keys`) sees an array now."
