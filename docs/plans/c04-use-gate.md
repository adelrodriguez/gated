# c04 — `useGate(evaluator)`

Fixes: D2, D5, D1 (partial: removes the wrapper, not the multi-gate waterfall —
c05 removes that). Depends on: c01, c03. Additive.

## Goal

Components consume evaluators directly, with no per-gate factory step and no
manual `changes` wiring:

```tsx
const beta = useGate(betaAccess) // boolean, suspends
const theme = useGate(checkoutTheme, identity) // "light" | "dark" | "system"
```

## Problem

`createReactGate` exists to hold per-hook state in a closure: default cache,
cache namespace, version stores, `changes` subscription, statics
(`src/integrations/react.tsx:96-262`). None of that state needs a closure —
evaluators are stable module-scope objects and can key it. The factory step is
pure boilerplate (`examples/react/src/shared/gates/client.ts:44-46`), and live
updates require every call site to pass `changes: gate.changes` by hand.

## Design

```ts
export function useGate<TFlag extends AnyGateEvaluator>(
  flag: TFlag,
  identity?: GateIdentityOf<TFlag>
): GateValueOf<TFlag>
```

- Per-evaluator state lives in a module-scope
  `WeakMap<evaluator, PerGateState>`, lazily created on first use.
  `PerGateState` holds the cache namespace and the `changes` attach/detach
  bookkeeping — the closure contents of today's `createReactGate`, relocated.
- Cache resolution: provider cache from `GateProvider` context, else one shared
  module-scope default cache owned by the integration (replacing today's
  one-default-cache-per-created-hook). The server-rendering development warning
  moves here unchanged: structural safety comes from c03's auto-created provider
  cache, the warning covers unmounted-provider setups.
- Identity resolution: explicit argument, else `GateProvider` `identity`, else
  none (the evaluator's own `identify` config applies, unchanged core
  semantics). The resolved identity participates in the cache key exactly as the
  hook argument does today (`deriveKey`).
- `changes` wiring is automatic: `getEvaluatorFactoryRef(flag).changes` (c01)
  replaces the `options.changes` plumbing. Subscription attach/detach and the
  flag-key filter keep today's semantics (`react.tsx:124-148`) but live in the
  shared state.
- Version stores use the registry hoisted in c03, keyed `(cache, key)`, so
  `useGateCache().invalidate` reaches entries created by `useGate`.
- Evaluation, `evictOnRejection`, and the Suspense contract (`use(promise)`,
  boundary required) are copied from `useGateValue` unchanged
  (`react.tsx:223-244`).
- A non-evaluator argument (no registry entry) throws a typed error naming
  `createReactGate` as the escape hatch for custom functions.
- Types: `GateValueOf`/`GateIdentityOf` are conditional extractions from
  `GateEvaluator`. Exported — c06 reuses them.
- `createReactGate` is not touched by this slice beyond delegating to the shared
  internals where they moved (cache default, store registry). Its observable
  behavior is unchanged.

## Changes

- `src/integrations/react.tsx` — `useGate`, per-evaluator state WeakMap, shared
  default cache, automatic changes wiring, type extractors; `createReactGate`
  rebased onto the shared internals.
- README — client quick start rewritten around `useGate`; `createReactGate`
  moved to the custom-function section (full rewrite lands in c07; this slice
  updates the quick start only).
- CONTEXT.md — React paragraph: components call `useGate` with evaluators;
  Suspense contract unchanged.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Boolean and variant evaluators resolve with correct values and types
  (type-level assertions in `entrypoints.types.ts`).
- Two components using the same evaluator and identity share one evaluation
  (one provider call).
- Identity precedence: argument > provider `identity` > none; each yields a
  distinct cache entry.
- A provider `subscribe` emission for the flag's key re-renders and re-evaluates;
  an emission for an unrelated key does not (automatic `changes`).
- Detach: after the last subscribed component unmounts, the changes subscription
  detaches (mirror the existing attach/detach tests).
- `useGateCache().invalidate(flag, identity)` evicts a `useGate` entry and
  re-renders.
- Rejection: failed evaluation is observed by the retry render, then evicted
  (existing `evictOnRejection` semantics).
- Passing a plain async function throws the typed error.
- `createReactGate` test suite passes unchanged.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `useGate(evaluator, identity?)`: evaluators are usable
  in components directly, with automatic live-update wiring and provider-scoped
  caching. `createReactGate` is unchanged."
