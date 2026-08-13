# c05 — `useGateBatch`

Fixes: D1. Depends on: c02, c04 (c01 transitively). Additive.

## Goal

N gates render as one unit: one cached `batch()` promise, one `decideMany`
round trip, one suspension, one Suspense reveal.

```tsx
const [beta, theme, nav] = useGateBatch([betaAccess, checkoutTheme, newNav], { identity })
```

This is the series' founding requirement: "wait for three gates before
rendering."

## Problem

Per-gate hooks in one component waterfall: the first `use()` suspends before the
next hook creates its promise (D1). Sibling `FeatureGate` components evaluate in
parallel but as N separate `decide` calls. Nothing in the React layer reaches the
server's batch path (`executeGateBatch`, `decideMany`), so the coordinated
"reveal when all are ready" case costs N round trips and hand-rolled Suspense
choreography.

## Design

```ts
export function useGateBatch<const TFlags extends readonly AnyGateEvaluator[]>(
  flags: TFlags,
  options?: { identity?: GateBatchIdentityOf<TFlags>; ttlMs?: number }
): GateBatchValuesOf<TFlags>
```

- Resolve the factory ref of `flags[0]` via `getEvaluatorFactoryRef` (c01).
  Throw `ForeignGateEvaluatorError` when any member resolves to a different ref
  or to none — the same failure `gate.batch` raises today
  (`src/factory.ts:228`), now raised client-side before the call.
- An empty `flags` array resolves to an empty batch tuple without factory-ref
  resolution, provider work, or suspension — parity with the server, where
  `executeGateBatch` returns an empty `Map` before identity resolution
  (`src/lib/evaluation/batch.ts:31-33`), so `gate.batch([])` resolves. Do not
  route `[]` through the foreign-evaluator rule: `flags[0]` being `undefined`
  is not a foreign evaluator.
- Cache one promise per invocation shape, in a batch bucket of the active cache
  (c03's bucketed structure). Entry key: the ordered flag keys plus the
  serialized resolved identity. Array identity of the `flags` literal is
  irrelevant — a new array per render hits the same entry. Same flag set in a
  different order is a distinct entry; document this, do not sort. `ttlMs` is
  stamped at entry creation, matching `useGate`.
- The cached promise is `ref.batch(flags, { identity })`. With c02 the resolved
  value is already the destructurable tuple (plus `get`/`details`); `use()`
  returns it as-is. `get`/`details` are synchronous after the suspension —
  parity with the server batch contract.
- Cache and identity resolution, `evictOnRejection`, version stores, and the
  Suspense contract are shared with `useGate` (c04 internals).
- `changes`: a subscription emission matching **any** member flag key bumps the
  batch entry's store (the per-gate filter generalizes to set membership). The
  whole batch re-evaluates; per-member refetch is out of scope — a batch is one
  unit by definition.
- `cache.invalidateBatch(flags, identity?)` (c03) treats a batch entry as one
  invalidation target. Per-member invalidation of a batch entry is out of scope
  for the same reason.
- Duplicate flags in one batch already throw `DuplicateBatchKeyError` in
  `executeGateBatch`; surface it unchanged.

## Changes

- `src/integrations/react.tsx` — `useGateBatch`, batch bucket and key
  derivation, batch membership in the changes filter, `invalidateBatch` wiring,
  `GateBatchValuesOf`/`GateBatchIdentityOf` types.
- README — "Batching in React" section: the waterfall problem, the hook, one
  Suspense boundary around the consumer as the "wait for N gates" recipe.
- CONTEXT.md — React paragraph gains the batch hook sentence.
- domain.md — extend the **batch** row: reachable from React through
  `useGateBatch`.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Three flags: exactly one `decideMany` provider call; values destructure in
  order with correct types (type-level assertions in `entrypoints.types.ts`).
- One suspension: the component body runs once before suspending and once after
  resolution (no waterfall re-suspension).
- A new array literal per render reuses the cache entry; reordered flags create
  a distinct entry.
- Mixed-factory arrays throw `ForeignGateEvaluatorError`; duplicate flags throw
  `DuplicateBatchKeyError`.
- `useGateBatch([])` renders without suspension or provider work and
  destructures to nothing.
- Identity precedence (option > provider `identity` > identify sentinel) and
  per-identity entries (mirror c04).
- A `subscribe` emission for one member key re-evaluates the batch; an unrelated
  key does not.
- `cache.invalidateBatch` evicts and re-renders.
- Fallback semantics: one member falling back to its default (provider error for
  that key) does not reject the batch — parity with `executeGateBatch` tests.
- Entrypoint pins: `useGateBatch` joins the runtime surface in
  `src/__tests__/entrypoints.test.ts`; `GateBatchValuesOf` and
  `GateBatchIdentityOf` get type-level assertions in
  `src/__tests__/entrypoints.types.ts`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `useGateBatch([flags], identity?)`: one `decideMany`
  round trip and one suspension for N gates. Wrap the consumer in one Suspense
  boundary to reveal all gated UI together."
