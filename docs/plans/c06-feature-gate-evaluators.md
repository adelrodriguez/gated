# c06 — `FeatureGate` takes evaluators

Fixes: D8. Depends on: c04. Breaking (`gate` prop changes from hook to
evaluator).

## Goal

`FeatureGate` receives the evaluator itself; `match` and `identity` types derive
from it:

```tsx
<FeatureGate gate={betaAccess} identity={user} loading={<Skeleton />}>
  <BetaBanner />
</FeatureGate>

<FeatureGate gate={checkoutTheme} match="dark" fallback={<LightCheckout />}>
  <DarkCheckout />
</FeatureGate>
```

## Problem

The `gate` prop is a `createReactGate` hook, and `GateSlot` calls it as one
(`src/integrations/react.tsx:279`). Passing hooks as props is fragile under
rules-of-hooks lint and the React Compiler, forces the wrapper step the series
removes, and recovers `match` typing through `ReturnType` instead of the
evaluator's variant tuple.

## Design

- `GateSlot` swaps `gate(identity)` for `useGate(gate, { identity })` (c04). The dev
  warning for a missing `match` on variant gates, the `match ?? true`
  comparison, and the `loading`-wraps-Suspense structure carry over unchanged
  (`react.tsx:281-321`).
- Overloads move from function-typed to evaluator-typed props, reusing c04's
  extractors:
  - Boolean evaluator: `match?: boolean`.
  - Variant evaluator: `match: GateValueOf<TFlag>` (required).
  - Both: `identity?: GateIdentityOf<TFlag>`.
- Breaking migration: consumers replace `gate={useBetaAccess}` with
  `gate={betaAccess}` and delete the `createReactGate` wrapper. `FeatureGate`
  accepts only registered evaluators — custom-function gates
  (`useGate(fn, { key })`) render through their own component, not through
  `FeatureGate` (typed error, same as `useGate` without a `key`).
- Sibling `FeatureGate` components under one Suspense boundary evaluate in
  parallel (siblings render past a suspended sibling) — document this as the
  component-level "wait for N gates" recipe, with `useGateBatch` (c05) as the
  single-round-trip alternative.
- Deferred, per the source document: a `FeatureGates` render-prop plural. Do not
  implement in this slice.

## Changes

- `src/integrations/react.tsx` — `GateSlot` and `FeatureGate` prop types and
  overloads.
- `examples/react` — client demos drop the hook wrappers and pass evaluators.
- README — every `FeatureGate` example updated; migration note.

## Tests

Update `src/integrations/__tests__/react.test.tsx`:

- Existing `FeatureGate` behavior tests (children/fallback/loading/match, dev
  warning) pass with evaluators in the `gate` prop.
- Variant evaluator without `match` warns in development and renders `fallback`.
- Type-level: `match` on a variant evaluator only accepts its variants;
  `identity` follows the evaluator's identity type; a boolean evaluator rejects
  a string `match`.
- Three sibling `FeatureGate`s under one boundary: all three provider calls
  start in the same render pass (parallel, no waterfall), and the boundary
  reveals only after all resolve.
- A non-evaluator `gate` prop surfaces the typed error.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor (pre-1.0 breaking). "`FeatureGate` now takes an evaluator in
  `gate` instead of a `createReactGate` hook. Migration: pass the evaluator and
  delete the wrapper. `match` and `identity` are now inferred from the
  evaluator."
