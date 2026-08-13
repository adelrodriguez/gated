# c01 — Evaluator back-references in the registry

Fixes: D3. Depends on: —. Internal seam, no public API change.

## Goal

Given only an evaluator, internal code can reach the factory surface that created
it: its `batch` implementation and its `changes` feed. This unlocks standalone
batch evaluation (c05) and automatic `changes` wiring (c04) without threading the
factory through consumer code.

## Problem

The registry stores only a flag key per evaluator
(`src/lib/evaluation/registry.ts`). The factory's `definitions` WeakMap and
`config` live in the `buildGate` closure (`src/factory.ts:159`), so `batch()` is
callable only as a method on the factory. A list of evaluators cannot be batched,
and the React integration cannot discover `gate.changes` on its own (consumers
must pass it manually).

## Design

Extend the registry with a second WeakMap, same pattern as `flagKeysByEvaluator`:

```ts
type EvaluatorFactoryRef = {
  batch: (
    flags: readonly AnyGateEvaluator[],
    callOptions?: GateCallOptions<never>
  ) => Promise<unknown>
  changes: GateChanges
}

const factoryRefsByEvaluator = new WeakMap<object, EvaluatorFactoryRef>()

export function setEvaluatorFactoryRef(evaluator: object, ref: EvaluatorFactoryRef): void
export function getEvaluatorFactoryRef(evaluator: object): EvaluatorFactoryRef | undefined
```

- One `EvaluatorFactoryRef` object per factory, created once inside `buildGate`
  and registered for every evaluator next to the existing `setEvaluatorFlagKey`
  call (`src/factory.ts:216`). Reference equality of the ref identifies "same
  factory" — c05 uses this to reject mixed-factory batches.
- `buildGate` defines evaluators before `Object.assign` attaches `batch`. Hoist
  the batch implementation into a named function above the `gate` definition and
  let both the ref and `Object.assign` point at it. Do not register a forwarding
  closure per evaluator.
- The ref is intentionally untyped at the value level (`Promise<unknown>`);
  callers that know the flag tuple (c05) cast at the call site. Keeping the
  registry weakly typed avoids exporting factory generics from the registry
  module.
- WeakMap keeps the seam leak-free: an evaluator that becomes unreachable drops
  its ref with it.

## Changes

- `src/lib/evaluation/registry.ts` — the two functions and the ref type above.
- `src/factory.ts` — hoist `batch` into a named function; build the ref once;
  register it per evaluator beside `setEvaluatorFlagKey`.

## Tests

Extend `src/__tests__/core.test.ts` (or a colocated registry test):

- Evaluators from one factory share one ref (reference equality).
- Evaluators from two factories have different refs.
- `getEvaluatorFactoryRef(evaluator).batch([evaluator])` resolves with the same
  values as `gate.batch([evaluator])`.
- An object that is not a registered evaluator returns `undefined`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- No changeset. Internal refactor with no observable behavior change; folded
  into the c05 changeset narrative if release notes need the seam mentioned.
