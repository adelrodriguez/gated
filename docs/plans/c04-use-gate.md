# c04 — `useGate(evaluator)` with hook options

Fixes: D2, D5, D1 (partial: removes the wrapper, not the multi-gate waterfall —
c05 removes that). Depends on: c01, c03. Additive.

## Goal

Components consume evaluators directly. Per-gate configuration lives in hook
options, per call site; a named custom hook is a plain consumer wrapper, not a
library API:

```tsx
const beta = useGate(betaAccess) // boolean, suspends
const theme = useGate(checkoutTheme, { identity }) // "light" | "dark" | "system"
const details = useGate(checkoutTheme, { details: true }) // EvaluationDetails

function useBetaAccess() {
  return useGate(betaAccess, { ttlMs: 60_000 }) // consumer convention
}

function useAudienceLabel(identity: DemoIdentity, prefix: string) {
  return useGate(() => audienceLabel(identity, prefix), {
    key: [identity.distinctId, prefix], // fn form: key required
  })
}
```

## Problem

`createReactGate` exists to hold per-hook state and configuration in a closure
(`src/integrations/react.tsx:96-262`). None of that needs a closure: evaluators
are stable module-scope objects that can key state, and configuration belongs at
the call site (the TanStack Query model). The factory step is pure boilerplate
(`examples/react/src/shared/gates/client.ts:44-46`), live updates require every
call site to pass `changes: gate.changes` by hand, and the `cacheKey` projection
exists only because configuration was frozen at definition time — at the hook,
the caller has the arguments and can pass the computed key directly.

## Design

```ts
// evaluator form
export function useGate<TFlag extends AnyGateEvaluator>(
  flag: TFlag,
  options?: { identity?: GateIdentityOf<TFlag>; ttlMs?: number; details?: false }
): GateValueOf<TFlag>
export function useGate<TFlag extends AnyGateEvaluator>(
  flag: TFlag,
  options: { identity?: GateIdentityOf<TFlag>; ttlMs?: number; details: true }
): GateDetailsOf<TFlag>
// arbitrary-function form
export function useGate<TValue>(
  fn: () => Promise<TValue>,
  options: { key: GateCacheKey; ttlMs?: number }
): TValue
```

- **Key derivation.** Evaluator form: bucket = the evaluator object, entry key =
  serialized resolved identity (explicit option, else provider `identity`, else
  an identify sentinel meaning "the core `identify` resolves it" — the same
  keying the current hook gives `args[0] === undefined`). Function form: the
  custom-key bucket, entry key = the required `key` option serialized through
  the existing `serializeKey` strictness. No `cacheKey` projection anywhere.
- **One entry serves value and details.** The entry caches the details
  evaluation (`flag.details(callOptions)`); the value form projects `.value`
  from the resolved details. `details: true` returns the details object.
  The fn form has no details (type-level exclusion: no `details` option).
- **Options semantics.** `ttlMs` is stamped when the entry is created; readers
  do not re-stamp. `identity` participates in the key, so divergent call sites
  produce distinct entries, never conflicts. There is no `cache` option — the
  provider is the only cache seam.
- **Cache resolution.** Provider cache from `GateProvider` context, else the
  integration's shared default `createGateCache()` instance (c03). Per-gate
  buckets make per-gate bounds the default; subtree-wide tuning goes through
  `<GateProvider cache={createGateCache(options)}>`.
- **`changes` wiring is automatic** for evaluators:
  `getEvaluatorFactoryRef(flag).changes` (c01) replaces the `options.changes`
  plumbing. Attach/detach and the flag-key filter keep today's semantics
  (`react.tsx:124-148`), relocated to module-scope per-evaluator state
  (`WeakMap<evaluator, PerGateState>`). Fn-form gates have no changes feed and
  no identify fallback — they are inert cached async calls, invalidated via
  `cache.invalidateKey`; document this.
- Version stores use the registry hoisted in c03; `cache.invalidate` reaches
  entries created by `useGate`.
- Evaluation, `evictOnRejection`, and the Suspense contract (`use(promise)`,
  boundary required) carry over from `useGateValue` (`react.tsx:223-244`).
  Rejections rethrow through `use()` into the nearest Error Boundary; core
  fallback semantics mean most failures resolve to defaults, but strict-mode
  identity errors reject. Document this next to the Suspense contract.
- A non-evaluator first argument without a `key` option throws a typed error
  naming the fn form's requirement.
- Types: `GateValueOf`/`GateIdentityOf`/`GateDetailsOf` are conditional
  extractions from `GateEvaluator`. Exported — c06 reuses them.
- `createReactGate` is untouched (removed in c07); it keeps its closure caches
  and old context during the series.

## Changes

- `src/integrations/react.tsx` — `useGate` (both forms), per-evaluator state
  WeakMap, key derivation, details projection, automatic changes wiring, type
  extractors.
- README — client quick start rewritten around `useGate` (full rewrite lands in
  c07; this slice updates the quick start only).
- CONTEXT.md — React paragraph: components call `useGate` with evaluators;
  Suspense contract unchanged.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Boolean and variant evaluators resolve with correct values and types
  (type-level assertions in `entrypoints.types.ts`).
- Two components using the same evaluator and identity share one evaluation
  (one provider call); value and details forms share one entry (one provider
  call for both).
- `details: true` returns source, payload, and fallback error; type-level:
  the fn form rejects a `details` option.
- Identity precedence: option > provider `identity` > identify sentinel; each
  yields a distinct entry. Changing the provider `identity` value re-keys
  (fresh evaluation, old entry intact until expiry).
- Fn form: same `key` shares an entry across components; `key` is required
  (typed error without it); non-plain keys throw under existing `serializeKey`
  strictness; `cache.invalidateKey` evicts and re-renders.
- `ttlMs` stamped at creation: a second call site with a different `ttlMs` does
  not re-stamp an existing entry.
- A provider `subscribe` emission for the flag's key re-renders and
  re-evaluates; an emission for an unrelated key does not; after the last
  subscribed component unmounts, the changes subscription detaches.
- Rejection: failed evaluation is observed by the retry render, then evicted
  (existing `evictOnRejection` semantics); strict-mode identity errors reach an
  Error Boundary.
- Entrypoint pins: `useGate` joins `src/__tests__/entrypoints.test.ts`;
  `GateValueOf`, `GateIdentityOf`, and `GateDetailsOf` get type-level
  assertions in `entrypoints.types.ts`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `useGate(evaluator, options?)` and
  `useGate(fn, { key })`: evaluators are usable in components directly, with
  per-call-site options, automatic live-update wiring, provider-scoped caching,
  and a `details` option."
