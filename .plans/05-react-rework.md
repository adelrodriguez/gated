# 05 — React integration rework

Fixes: H2 (loading fallback dead code), H3 (uncached promise loop), H10 (`match ?? true` on variant gates). Delivers: arch win #4. No hard dependency on core plans — can run in parallel with 03/04, but coordinate evaluator and identity-facing signatures with plan 08. Breaking for `FeatureGate` semantics.

Urgent: the integration is currently unusable with real async gates.

## Goal

`createReactHook` suspends once per (gate, identity) and resolves stably. `FeatureGate`'s `loading` prop actually shows during suspension. Verified with genuinely async gates.

## Changes

### `createReactHook` — promise caching (H3)

`use(gateFn(overrideIdentity))` (src/integrations/react.tsx:40) creates a fresh promise per render. Cache instead:

```ts
export function createReactHook<TIdentity extends Identity, TValue extends boolean | string>(
  gateFn: (overrideIdentity?: TIdentity) => Promise<TValue>,
  options?: {
    cache?: ReactGateCache
    maxEntries?: number
    ttlMs?: number
  }
) {
  const cache = options?.cache ?? createReactGateCache(options)

  function useGateValue(overrideIdentity?: TIdentity): TValue {
    const key = overrideIdentity === undefined ? "" : stableSerialize(overrideIdentity)
    let promise = cache.get(key)
    if (!promise) {
      promise = gateFn(overrideIdentity)
      cache.set(key, promise)
    }
    return use(promise)
  }
  return useGateValue
}
```

- `stableSerialize`: JSON.stringify with sorted keys (identities are flat records; document that identity values must be JSON-serializable).
- Successful entries remain stable across suspension and immediate re-renders but are bounded by configurable TTL and LRU size. Choose conservative documented defaults; expiration causes re-evaluation on the next render and does not schedule its own render.
- Expose `useGateValue.invalidate(identity?)` and `useGateValue.clear()` so consumers can force re-evaluation.
- Export `createReactGateCache` and accept an injected cache. Server consumers must create this cache per request; document that sharing a module-level cache across SSR requests can retain identities and stale decisions across users.
- Failed promises: delete the cache entry on rejection so an error isn't cached forever.

### `FeatureGate` — evaluate inside the boundary (H2)

The IIFE (src/integrations/react.tsx:84-88) runs during `FeatureGate`'s own render, so suspension escapes its own `<Suspense>`. Move evaluation into an internal child:

```tsx
function GateSlot(props) {
  const value = props.gate(props.overrideIdentity) // may suspend HERE, inside the boundary
  return value === props.matchValue ? props.children : props.fallback
}

export function FeatureGate(props) {
  return (
    <Suspense fallback={props.loading}>
      <GateSlot {...props} />
    </Suspense>
  )
}
```

### `match` runtime guard (H10)

In `GateSlot`, when `match` is `undefined` and the gate returned a string, this is a misuse the overloads couldn't catch (JS consumers). Do not silently compare against `true`: log a descriptive `console.error` in development and render the fallback. Document in README.

## Tests

Replace the shallow assertions (src/**tests**/react.test.tsx:9-59 test `.name`/`.length`, and every gate is sync) with behavior:

- **Regression (H2):** async gate (`new Promise` + `setTimeout`) — `loading` node IS in the document while suspended; feature appears after resolution. This is the review's failing repro, inverted into a passing test.
- **Regression (H3):** async gate — count `gateFn` invocations across the suspend/resolve/re-render cycle; must be exactly 1. Re-render the parent; still 1.
- Two identities → two evaluations; same identity twice → one evaluation.
- Rejected gate promise: error propagates to an error boundary; a subsequent render retries (cache entry evicted).
- TTL expiry, LRU eviction, `invalidate()`, and `clear()` trigger re-evaluation on the next render.
- An injected request-scoped cache isolates two simulated SSR requests; neither request reuses the other's identities or decisions.
- Variant gate without `match`: fallback rendered + dev warning (spy on `console.error`).
- Keep existing sync-gate tests that assert match/fallback semantics; delete the `.name`/`.length`/`typeof` tests.

## Docs

- README React section: state that hook results are cached per identity with bounded TTL/LRU retention, how to invalidate or clear entries, how to create request-scoped SSR caches, and that `loading` works now; keep the Suspense-boundary requirement note for `createReactHook` used directly.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "React: `createReactHook` uses a bounded, configurable promise cache per identity (fixes infinite re-suspension without retaining identities indefinitely), `FeatureGate`'s `loading` fallback now renders during suspension, and variant gates without `match` fail loudly in development."
