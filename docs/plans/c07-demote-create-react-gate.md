# c07 — Demote `createReactGate`; docs migration

Fixes: D2 (closure). Depends on: c01–c06. Docs and deprecation only; no runtime
behavior change.

## Goal

The documented React API is `useGate`, `useGateBatch`, `GateProvider`,
`useGateCache`, and `FeatureGate`. `createReactGate` is documented for exactly
one job: wrapping an arbitrary async function with a `cacheKey` projection
(server actions, bespoke fetchers — anything that is not a registered
evaluator).

## Problem

After c04–c06 the library has two ways to consume an evaluator in React. Leaving
both documented as peers reads as indecision and steers new consumers into the
boilerplate path the series removed. The remaining legitimate use of
`createReactGate` — the custom-function overload
(`examples/react/src/shared/gates/client.ts:55`) — is buried under the
plain-evaluator examples.

## Design

- TSDoc: mark the plain-evaluator `createReactGate` overload `@deprecated` with
  a pointer to `useGate`. The custom-function overload (`cacheKey` required)
  stays undeprecated. Runtime behavior of both stays identical; removal of the
  deprecated overload is a later major, tracked as a follow-up issue.
- README rewrite, in this order:
  1. Client quick start: `GateProvider` at the root, `useGate` in components,
     `FeatureGate` for declarative gating.
  2. Batching: server `gate.batch` destructuring, then `useGateBatch` and the
     one-boundary "wait for N gates" recipe.
  3. Invalidation and live updates: `useGateCache`, `createGateCacheHandle`,
     automatic `changes`.
  4. SSR: bare `<GateProvider>`; the per-request rule stated as satisfied by
     construction.
  5. Escape hatch: `createReactGate` with `cacheKey` for custom functions —
     the only remaining appearance.
- `examples/react` sweep: no `createReactGate` usage remains except one custom
  `cacheKey` demo, relabeled as the escape hatch.
- CONTEXT.md React paragraph rewritten around the new surface.
- domain.md: final vocabulary pass for the series (**gate provider**, **cache
  handle** rows landed in c03; verify cross-references and the **integration**
  row).
- Issue tracker: file the follow-up issue for the eventual overload removal per
  `docs/agents/issue-tracker.md`.
- Delete `docs/plans/` Series C files in the series' closing PR, matching the
  Series A/B cleanup convention.

## Changes

- `src/integrations/react.tsx` — TSDoc deprecation only.
- README, CONTEXT.md, domain.md, `examples/react` — as above.

## Tests

- No behavior changes. Verify the deprecated overload still passes its existing
  suite. Type-level: deprecation does not alter inference for either overload.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- Manual: README examples compile against the built package (`bun run
check:exports` if present in scripts).

## Release

- Changeset: patch. "Documentation: the React API is now presented as
  `useGate`/`useGateBatch`/`GateProvider`/`FeatureGate`. `createReactGate`
  remains supported; its plain-evaluator overload is deprecated in favor of
  `useGate`."
