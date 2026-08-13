# c08 — Preload seam (`cache.prefetch`)

Delivers: source-document decision 14. Depends on: c03, c04. Additive.

## Goal

Consumers can warm the cache before a component renders — route loaders, hover
intent, navigation prediction — so the eventual `useGate` call resolves without
suspending:

```ts
const cache = createGateCache()

// route loader, hover handler, or navigation event
void cache.prefetch(betaAccess, { identity })
void cache.prefetchBatch([betaAccess, checkoutTheme], { identity })
```

## Problem

The cache fills only when a component renders and suspends. Everything upstream
of render — route transitions, hover intent — is wasted lead time: the provider
round trip starts at paint instead of at intent. TanStack Query's
`prefetchQuery` is the proven shape for this seam.

## Design

- `prefetch(flag, options?)` and `prefetchBatch(flags, options?)` join the
  cache object from c03. Options mirror the hooks: `{ identity?, ttlMs? }`.
- Semantics: derive the entry key exactly as `useGate`/`useGateBatch` would
  (c04/c05 key derivation, including the identify sentinel), and create the
  entry only if absent — an existing pending or resolved entry is never
  replaced, so prefetch can race a render safely. Returns a `Promise<void>`
  that settles when the evaluation settles; callers fire-and-forget.
- A prefetched rejection follows the same `evictOnRejection` path as a rendered
  evaluation, so a failed prefetch does not poison the entry past its retry
  window.
- Prefetch does not subscribe to `changes` and creates no version store; stores
  attach when a component first subscribes (existing c03/c04 machinery).
- No fn-form prefetch: `useGate(fn, { key })` closures live in components, so
  there is nothing stable to prefetch. Consumers who need it can call their
  function and warm state themselves; note this in the docs.
- No provider-identity fallback: prefetch runs outside React, so `identity`
  comes from options or the core `identify` only. Document the asymmetry.

## Changes

- `src/integrations/react.tsx` — `prefetch`/`prefetchBatch` on
  `createGateCache`'s returned object.
- README — a short "Preloading" section under the client docs: route-loader and
  hover examples, the create-only semantics, the fn-form and identity notes.
- domain.md — extend the **gate cache** row with the prefetch capability.

## Tests

Extend `src/integrations/__tests__/react.test.tsx`:

- Prefetch then render: the component reads the value without suspending (no
  second provider call).
- Render then prefetch: the existing entry is untouched (no second provider
  call); prefetch's promise settles with it.
- Two concurrent prefetches of the same key evaluate once.
- `prefetchBatch` issues one `decideMany` and matches a later
  `useGateBatch([same], { identity })` entry.
- A rejected prefetch is evicted on schedule and a later render retries.
- Entrypoint pin: the widened cache type in `entrypoints.types.ts`.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "Add `cache.prefetch(flag, options?)` and
  `cache.prefetchBatch(flags, options?)` to warm evaluations before render."
