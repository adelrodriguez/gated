# c07 — Remove `createReactGate` and `GateCacheProvider`

Fixes: D2 (closure). Depends on: c01–c06. Breaking (removal of two public
exports from `gated/react`).

## Goal

The React entrypoint is exactly the final surface: `useGate`, `useGateBatch`,
`useGateCache`, `FeatureGate`, `GateProvider`, `createGateCache`. Nothing else.
There is no definition step of any kind.

## Problem

After c03–c06 land, `createReactGate` and `GateCacheProvider` have no remaining
job. Per-gate configuration lives in hook options; the custom-function case is
`useGate(fn, { key })` — the caller passes the computed key, so the `cacheKey`
projection (the last reason for a definition step) is obsolete. `GateCacheProvider`
has no consumers once `createReactGate` is gone. Keeping either as a deprecated
path doubles the surface, doubles the closure/state machinery in
`src/integrations/react.tsx`, and steers new consumers into the boilerplate the
series removed.

## Design

- Delete `createReactGate`, its closure cache/version-store/changes machinery,
  the old `GateCacheContext` shape, `GateCacheProvider`, and the
  `CustomReactGate`/`ReactGate`/`CreateReactGateOptions`/`cacheKey`-projection
  types. Everything the new surface shares (bucketed cache, version stores,
  `evictOnRejection`, dev warning) already lives module-scope after c03/c04.
- Pre-1.0, removal ships as a minor with a migration table in the changeset:

| Before                                                | After                                        |
| ----------------------------------------------------- | -------------------------------------------- |
| `const useX = createReactGate(flag)` + `useX()`       | `useGate(flag)`                              |
| `useX(identity)`                                      | `useGate(flag, { identity })`                |
| `createReactGate(flag, { ttlMs, maxEntries })`        | hook `ttlMs`, or `GateProvider` cache bounds |
| `createReactGate(fn, { cacheKey })` + `useX(...args)` | `useGate(() => fn(...args), { key })`        |
| `useX.invalidate(identity)` / `useX.clear()`          | `useGateCache().invalidate(flag, identity)`  |
| `<GateCacheProvider cache={...}>`                     | `<GateProvider cache={...}>` or bare mount   |
| `changes: gate.changes` option                        | automatic (registry back-reference)          |

- README rewrite, in this order:
  1. Client quick start: `GateProvider` at the root (SSR) or nothing
     (client-only), `useGate` in components, `FeatureGate` for declarative
     gating.
  2. Batching: server `gate.batch` destructuring, then `useGateBatch` and the
     one-boundary "wait for N gates" recipe.
  3. Options: `identity`, `ttlMs`, `details`; the named-custom-hook wrapper
     convention shown once.
  4. Invalidation and live updates: the cache object, `useGateCache`,
     automatic `changes`; Error Boundary note next to the Suspense contract.
  5. SSR: bare `<GateProvider>` and the placement rule; the per-request rule
     stated as satisfied by construction.
  6. Custom functions: `useGate(fn, { key })` — no changes feed, no identify
     fallback, `invalidateKey` for eviction.
- `examples/react` sweep: no `createReactGate` or `GateCacheProvider` usage
  remains; the `audienceLabel` demo becomes a `useGate(fn, { key })` wrapper
  hook.
- CONTEXT.md React paragraph rewritten around the final surface.
- domain.md: final vocabulary pass for the series (**gate provider** and
  **gate cache** rows landed in c03; verify cross-references and the
  **integration** row; remove any `createReactGate` mention).
- Delete `docs/plans/` Series C files in the series' closing PR, matching the
  Series A/B cleanup convention (c08 may land after; if so, the cleanup moves
  there).

## Changes

- `src/integrations/react.tsx` — deletions listed above.
- `src/index.ts` / entrypoint wiring — remove the exports.
- README, CONTEXT.md, domain.md, `examples/react` — as above.

## Tests

- Delete the `createReactGate` and `GateCacheProvider` suites; port any
  behavior they pinned that the new surface still owns (rejection eviction,
  TTL expiry, variant validation pass-through) into the `useGate` suite if not
  already covered by c04.
- Entrypoint tests: remove the deleted exports from
  `src/__tests__/entrypoints.test.ts` and `entrypoints.types.ts`; assert the
  final export list exactly, so an accidental re-export fails.
- `bun run analyze` must pass with no unused-export or dead-code findings from
  the removal.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- Manual: README examples compile against the built package.

## Release

- Changeset: minor (pre-1.0 breaking). "Remove `createReactGate` and
  `GateCacheProvider`. The React API is `useGate`, `useGateBatch`,
  `useGateCache`, `FeatureGate`, `GateProvider`, and `createGateCache`." Include
  the migration table above.
