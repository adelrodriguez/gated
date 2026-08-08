# 05 — React integration rework

Fixes: H2 (loading fallback dead code), H3 (uncached promise loop), H10 (`match ?? true` on variant gates). Delivers: arch win #4. No hard dependency on core plans — can run in parallel with 03/04, but coordinate evaluator and identity-facing signatures with plan 08. Breaking for `FeatureGate` semantics and for the hook factory (renamed `createReactHook` → `createReactGate`).

Urgent: the integration is currently unusable with real async gates.

## Goal

`createReactGate` (renamed from `createReactHook`) suspends once per (gate, identity) and resolves stably, with explicit cache controls. `FeatureGate`'s `loading` prop actually shows during suspension when supplied and otherwise preserves an ancestor Suspense boundary. Verified with genuinely async gates.

## Changes

### `createReactGate` — rename + promise caching (H3)

Rename `createReactHook` → `createReactGate` (no deprecated alias; the semantics change anyway, so a clean break with one migration is better than a lying alias). Avoids the collision with the domain term "hook" (lifecycle extension) and describes the result as a React binding for a gate.

`use(gateFn(overrideIdentity))` (src/integrations/react.tsx:40) creates a fresh promise per render. Cache instead, and return the hook function with cache controls attached (Zustand-style callable-with-statics):

```ts
type AsyncGate<TArgs extends unknown[], TValue> = (...args: TArgs) => Promise<TValue>

export function createReactGate<TArgs extends unknown[], TValue extends boolean | string>(
  gateFn: AsyncGate<TArgs, TValue>,
  options?: {
    cache?: ReactGateCache
    maxEntries?: number
    ttlMs?: number
  }
) {
  const cache = options?.cache ?? createReactGateCache(options)
  const keyOf = (args: TArgs) => stableSerialize(args)

  function useGateValue(...args: TArgs): TValue {
    const key = keyOf(args)
    let promise = cache.get(gateFn, key)
    if (!promise) {
      promise = gateFn(...args)
      cache.set(gateFn, key, promise)
    }
    return use(promise)
  }

  useGateValue.invalidate = (...args: TArgs): void => {
    cache.delete(gateFn, keyOf(args))
  }
  useGateValue.clear = (): void => {
    cache.clear(gateFn)
  }

  return useGateValue
}
```

- The React binding mirrors the supplied gate's call parameters via `TArgs` rather than hard-coding the current bare-identity convention. When plan 08 changes `GateEvaluator` to an options object, the React call and `invalidate` signatures follow it automatically. The callable part of plan 07's `GateEvaluator` intersection and bare async functions are both assignable to `AsyncGate`.
- `stableSerialize`: JSON.stringify with sorted keys. Cache-key arguments must be JSON-serializable; plan 09 must explicitly exclude non-semantic objects such as `AbortSignal` from the key projection.
- The cache namespace is the gate function identity plus the serialized call arguments. An injected request cache may therefore be shared by multiple gates without one gate returning another gate's promise for the same identity.
- Successful entries remain stable across suspension and immediate re-renders but are bounded by configurable TTL and LRU size. TTL starts when a promise settles successfully, and only settled entries participate in TTL/LRU eviction. Pending promises are pinned, so the cache may temporarily exceed `maxEntries`; this is required to avoid recreating promises and re-entering a suspension loop. Expiration causes re-evaluation on the next render and does not schedule its own render.
- A promise that never settles remains pinned until explicit `invalidate`/`clear`; TTL and LRU cannot bound it without recreating the suspension loop. Plan 09's evaluation timeouts provide the automatic bound once that plan lands.
- Cache controls have unambiguous semantics: `invalidate(...gateArgs)` evicts that gate invocation's entry, `invalidate()` evicts the no-argument/default-identity entry, and the binding's `clear()` evicts every entry for that gate. The request cache may additionally expose a global `clear()` for request teardown or logout.
- Document staleness honestly: within TTL, entries cache for the lifetime of the cache instance. `invalidate`/`clear` (and TTL expiry) are **not reactive** — they take effect on the next render of a consuming component; they do not re-render already-mounted components. State this in the README and JSDoc.
- Export `createReactGateCache` and accept an injected cache. Its operations take a gate-function namespace and a serialized argument key; `clear(gateFn)` is scoped while `clear()` clears the full request cache. Server consumers must create this cache per request; document that sharing a module-level cache across SSR requests can retain identities and stale decisions across users.
- Reactive invalidation is a follow-up, out of scope for this slice. When it lands, use zustand's mechanism (see `.packref/packages/npm/zustand/5.0.14/src/vanilla.ts:88` and `react.ts:30`): a `Set<Listener>` + `subscribe` returning an unsubscribe closure, consumed via `useSyncExternalStore`. At that point move the cache + subscribe into a framework-agnostic module (zustand's vanilla/react split) so the React file stays a thin subscriber and future integrations reuse the store; plan 12's sync `snapshot.get()` is the natural server-snapshot (`getInitialState` analog) for SSR.
- Failed promises: delete the cache entry on rejection so an error isn't cached forever.
- Return type: name it explicitly (e.g. `ReactGate<TArgs, TValue>` — callable hook with the same arguments plus `invalidate`/`clear`) so it shows up in the public types rather than an anonymous intersection.

### `FeatureGate` — evaluate inside the boundary (H2)

The IIFE (src/integrations/react.tsx:84-88) runs during `FeatureGate`'s own render, so suspension escapes its own `<Suspense>`. Move evaluation into an internal child:

```tsx
function GateSlot(props) {
  const value = props.gate(props.overrideIdentity) // may suspend HERE, inside the boundary
  return value === props.matchValue ? props.children : props.fallback
}

export function FeatureGate(props) {
  if (props.loading === undefined) {
    return <GateSlot {...props} />
  }

  return (
    <Suspense fallback={props.loading}>
      <GateSlot {...props} />
    </Suspense>
  )
}
```

An omitted `loading` prop deliberately installs no internal boundary, so suspension reaches the nearest ancestor boundary and preserves its fallback. Passing `loading` explicitly, including `null`, installs the local boundary with exactly that fallback.

### `match` runtime guard (H10)

In `GateSlot`, when `match` is `undefined` and the gate returned a string, this is a misuse the overloads couldn't catch (JS consumers). Do not silently compare against `true`: log a descriptive `console.error` in development and render the fallback. Document in README.

## Tests

Replace the shallow assertions (src/**tests**/react.test.tsx:9-59 test `.name`/`.length`, and every gate is sync) with behavior:

- **Regression (H2):** async gate (`new Promise` + `setTimeout`) — `loading` node IS in the document while suspended; feature appears after resolution. This is the review's failing repro, inverted into a passing test.
- **Regression (H3):** async gate — count `gateFn` invocations across the suspend/resolve/re-render cycle; must be exactly 1. Re-render the parent; still 1.
- Two identities → two evaluations; same identity twice → one evaluation. Two different gates sharing one injected request cache and receiving the same identity remain isolated.
- Rejected gate promise: error propagates to an error boundary; a subsequent render retries (cache entry evicted).
- `invalidate(...gateArgs)` evicts only that invocation's entry (other identities still cached); `invalidate()` evicts the no-argument/default-identity entry; the binding's `clear()` evicts that gate's entries without flushing other gates in a shared request cache — each triggers re-evaluation on next render, as do TTL expiry and LRU eviction.
- A gate promise that takes longer than `ttlMs` remains pinned and is invoked once across suspension retries. More than `maxEntries` concurrently pending identities likewise invoke once each; LRU enforcement begins only as they settle.
- An injected request-scoped cache isolates two simulated SSR requests; neither request reuses the other's identities or decisions.
- `FeatureGate` with an explicit `loading` renders that local fallback; without `loading`, suspension reaches and renders an ancestor Suspense fallback.
- Variant gate without `match`: fallback rendered + dev warning (spy on `console.error`).
- Keep existing sync-gate tests that assert match/fallback semantics; delete the `.name`/`.length`/`typeof` tests.

## Docs

- README React section: rename to `createReactGate` everywhere; state that hook results are cached per gate and call arguments with settled-only bounded TTL/LRU retention, document `invalidate(...gateArgs)`/gate-scoped `clear()` and their non-reactive semantics, how to create request-scoped SSR caches, and that `loading` works when supplied while omission delegates to an ancestor boundary; keep the Suspense-boundary requirement note for `createReactGate` used directly.
- Update `CONTEXT.md` (mentions `createReactHook`).

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor (pre-1.0 breaking; rename is breaking). "Breaking migration: rename `createReactHook` to `createReactGate`; there is no compatibility alias. React gates use a gate-scoped, bounded promise cache whose pending entries are pinned (fixes infinite re-suspension without allowing cross-gate cache collisions), with invocation-specific `invalidate` and gate-scoped `clear()` controls. `FeatureGate` renders its `loading` fallback during suspension when provided and otherwise delegates to an ancestor Suspense boundary; variant gates without `match` fail loudly in development."
