# 2026-08-13 Svelte adapter

## Goal

Add a Svelte 5 adapter at `gated/svelte` that evaluates gates through idiomatic
readable stores. The adapter must share cache, batching, invalidation, prefetch,
and provider-change behavior with the React integration without exposing
React's Suspense model.

The second framework adapter establishes the real integration seam. Shared
policy moves behind one internal interface; React and Svelte keep their own
reactive adapters.

## Final surface

```ts
import {
  createGateBatchStore,
  createGateCache,
  createGateStore,
  getGateCache,
  setGateContext,
} from "gated/svelte"

setGateContext({ identity, cache: createGateCache() })

// Capture the active cache during component initialization for later handlers.
const cache = getGateCache()
const warmBeta = () => cache.prefetch(betaAccess, { identity })

const beta = createGateStore(betaAccess)
const theme = createGateStore(checkoutTheme, { details: true })
const dashboard = createGateBatchStore([betaAccess, checkoutTheme])
```

```svelte
{#if $beta.status === "pending"}
  <Spinner />
{:else if $beta.status === "error"}
  <ErrorMessage error={$beta.error} />
{:else if $beta.value}
  <BetaFeature />
{/if}
```

The public store state is discriminated:

```ts
type GateStoreState<T> =
  | { status: "pending"; promise: Promise<T> }
  | { status: "ready"; value: T }
  | { status: "error"; error: Error }
```

The `details: true` overload replaces `value` with typed evaluation details.
Batch stores use the same state shape, with the ready value typed as the batch
tuple.

## Decisions

1. Target Svelte 5. Use `Readable<T>` from `svelte/store`; do not require rune
   compilation in the published JavaScript. Readable stores have the required
   first-subscriber and last-unsubscriber lifecycle.
2. Do not copy React Suspense. Svelte consumers render the discriminated store
   state. The pending state contains the stable promise for consumers that want
   an `{#await}` block; the promise resolves to the same typed value that the
   store publishes in its ready state.
3. Do not add a Svelte `FeatureGate` in the first release. `{#if}` over a store
   value is already the native conditional-rendering interface. Add a component
   only when repeated consumer code proves that it earns its interface.
4. `createGateStore` and `createGateBatchStore` must be called during component
   initialization when they use context. Callers outside a component pass an
   explicit cache and identity or use cache prefetch methods.
5. `setGateContext` sets `{ cache, identity }` synchronously during parent
   component initialization. When no cache is supplied, it creates one for that
   component tree. This is the Svelte SSR isolation mechanism.
6. Use `setContext` and `getContext` with a private symbol instead of Svelte
   `createContext`, so the adapter can support all Svelte 5 versions rather than
   requiring the newer typed-context helper.
7. Explicit store options override context identity. Cache bounds belong to
   `createGateCache`; stores accept `ttlMs` but no per-store cache bounds.
8. A store starts evaluation when its first subscriber attaches, shares the
   cached evaluation with other stores, and detaches its provider-change
   subscription after its last subscriber leaves. Detaching a subscriber never
   cancels or evicts an in-flight evaluation; the request cache owns that work
   and can serve a later subscriber.
9. Matching provider changes and cache invalidation publish `pending`, start or
   join a fresh evaluation, and then publish `ready` or `error`. Unrelated flag
   changes do nothing.
10. Core fallback behavior remains unchanged. A store reaches `error` only when
    the evaluator rejects, such as a required-identity failure. Provider errors
    that core converts to defaults publish `ready`.
11. No custom-function store in the first release. Evaluators and evaluator
    batches prove the shared seam. Add custom async functions later only when a
    Svelte use case requires them.
12. Ship the adapter as an optional entry point. Importing `gated` or
    `gated/react` must not load Svelte.
13. Server rendering reads a settled resource synchronously through
    `GateResource.peek()`: the first subscription publishes `ready` or `error`
    from `peek()` before its initial callback returns, and falls back to `get()`
    when `peek()` returns `undefined`. This
    lets loader prefetch affect server HTML. A cache miss publishes `pending`,
    which is the intended server output because Svelte server rendering does not
    await store updates. The pending evaluation continues after the server
    subscription detaches. Without dehydration, browser hydration starts or
    joins the browser cache's evaluation independently.

## Shared module seam

After Plan Series C lands, move its proven framework-neutral behavior from the
post-Series-C `src/integrations/react.tsx` into `src/lib/integration/`:

```ts
type GateResource<T> = {
  get(): Promise<T>
  peek():
    | { status: "ready"; value: T }
    | { status: "error"; error: Error }
    | undefined
  invalidate(): void
  subscribe(listener: () => void): () => void
}

type IntegrationGateCache = {
  gate(flag, options): GateResource<EvaluationDetails<unknown>>
  batch(flags, options): GateResource<unknown>
  invalidate(...): void
  invalidateBatch(...): void
  invalidateKey(...): void
  clear(): void
  prefetch(...): Promise<void>
  prefetchBatch(...): Promise<void>
}
```

This is an internal interface, not a package-consumer export. Its implementation
owns:

- evaluator and batch type extraction;
- identity and batch key derivation;
- same-factory batch validation;
- per-gate, per-factory-batch, and custom-key buckets;
- stable promise creation, settled value and rejection recording, and rejection
  eviction;
- TTL, pending TTL, and per-bucket LRU bounds;
- invalidation and prefetch;
- provider-change filtering;
- listener attachment, notification, and disposal.

React keeps only context, the SSR warning, `useSyncExternalStore`, `use()`, and
`FeatureGate`. Svelte keeps only context resolution and readable-store state
projection. Do not introduce a framework adapter interface beyond what both
implementations actually use.

## Delivery plan

### S01 — Extract the shared integration cache

Depends on: Plan Series C c01–c08, implemented by PR #87. No public behavior
change.

- Move cache entries, buckets, key derivation, evaluation dispatch, batch
  validation, invalidation, prefetch, and change subscriptions from
  `src/integrations/react.tsx` to `src/lib/integration/`.
- Give the shared module the internal `GateResource` interface above.
- Adapt React to use resources without changing the `gated/react` exports or
  behavior.
- Move framework-neutral tests out of the React suite. Keep React tests focused
  on context, hooks, Suspense, and `FeatureGate`.
- Run dependency analysis to prove the shared module does not import React or
  Svelte.
- Reuse the post-Series-C integration `createGateCache`. This is the bucketed
  promise cache exported by `gated/react`, not the older flat internal cache in
  `src/lib/cache/index.ts`; S01 replaces the duplicate cache concepts with the
  shared integration cache before `gated/svelte` re-exports it.

### S02 — Add evaluator and batch stores

Depends on: S01. Additive.

- Add `src/integrations/svelte.ts`.
- Add Svelte as a development dependency and add a Svelte-aware test build that
  compiles fixture `.svelte` files before Vitest runs them. Keep plain store tests
  in Vitest; use compiled components only for context, rendering, and teardown.
- Implement `createGateStore` overloads for values and details.
- Implement `createGateBatchStore` with tuple inference and empty-batch parity.
- Implement first-subscriber evaluation and last-unsubscriber cleanup with a
  Svelte readable store.
- Publish pending, ready, and error states. Prevent an older evaluation from
  publishing after invalidation starts a newer evaluation.
- Reuse one resource for equivalent gate, identity, and batch shapes.
- Test boolean gates, variant gates, details payloads, batches, rejection,
  invalidation, provider changes, duplicate flags, foreign evaluators, and
  subscription disposal.
- Keep the new Svelte source and shared integration source above Vitest's 90%
  per-file coverage thresholds; run `pnpm run test:coverage` because the normal
  test command does not collect coverage.

### S03 — Add context and SSR isolation

Depends on: S02. Additive.

- Add `setGateContext`, `getGateCache`, and the internal context resolver.
- `setGateContext({ cache?, identity? })` creates one cache when omitted and
  returns the active cache for route or action integration.
- Define identity precedence: store option, then context identity, then core
  `identify`.
- Verify that two rendered trees with separate contexts do not share entries.
- Verify that one server request cannot retain another request's identity or
  promise.
- Verify that a prefetched settled resource renders `ready` server HTML, while a
  miss renders `pending` and leaves its evaluation running after the render
  subscription detaches. Verify that hydration evaluates against the browser
  cache because dehydration is out of scope.
- Document that context functions run during component initialization and that
  module-scope caches must not be shared across server requests.

### S04 — Package, document, and exercise the adapter

Depends on: S01–S03. Additive minor release.

- Add `gated/svelte` to `package.json` exports and `tsdown.config.ts`.
- Add `src/integrations/svelte.ts` to `knip.config.ts` entry points so dependency
  analysis treats its public exports as intentional.
- Add optional `svelte` peer dependency with the selected supported Svelte 5
  range. Pin the exact minimum after the implementation test matrix confirms
  it.
- Add runtime and type entry-point tests. Assert that core and React entry
  points do not expose or load Svelte symbols.
- Add a minimal SvelteKit example that covers SSR context isolation, a boolean
  store, a variant store, a batch store, invalidation, and prefetch.
- Run SvelteKit development and production build checks through this example,
  not through the root Vitest configuration.
- Add README sections for Svelte setup, state rendering, batching, SSR,
  invalidation, and error handling.
- Update `CONTEXT.md` and the domain vocabulary with the Svelte adapter and the
  shared integration cache.
- Add a minor Changeset: "Add `gated/svelte` with typed evaluator and batch
  stores, request-scoped context, live updates, invalidation, and prefetch."

## Test matrix

- Svelte client rendering and teardown.
- Svelte server rendering with two isolated requests in a DOM-free Vitest
  project that does not use the Happy DOM environment.
- SvelteKit development and production builds through the S04 example.
- Lowest supported Svelte 5 version and current Svelte 5 version.
- TypeScript inference for boolean, variant, payload, identity, and batch tuple
  types.
- No Svelte dependency when importing `gated`, `gated/hooks`, or `gated/react`.
- Existing React behavior remains unchanged after S01.

## Verification

- `pnpm run test`
- `pnpm run test:coverage` with the 90% per-file floor
- `pnpm run build`
- `pnpm run check`
- `pnpm run fix`
- `pnpm run format`
- `pnpm run analyze`
- Svelte example typecheck, test, and production build
- React example typecheck and production build

## Out of scope

- Svelte 4 support.
- A Svelte `FeatureGate` component.
- A custom-function store form.
- SvelteKit route-loader wrappers; loaders call cache prefetch directly.
- Cache dehydration or transfer from server rendering to browser hydration.
- A public generic framework-adapter interface.

## Source notes

- Svelte readable stores define the subscription and start/stop lifecycle used
  by this plan: <https://svelte.dev/docs/svelte/svelte-store>.
- Svelte context supplies values to descendants and must be set during component
  initialization: <https://svelte.dev/docs/svelte/context>.
- Svelte await blocks expose pending, fulfilled, and rejected promise states,
  but server rendering renders only the pending branch for a promise. This is
  why the adapter uses explicit store state for its primary interface:
  <https://svelte.dev/docs/svelte/await>.
