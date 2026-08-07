# 01 — Fix doc drift, export missing types

Fixes: H7, H8; API opportunity "export the `Gate` type". No dependencies. Non-breaking.

## Goal

All documented APIs actually exist; all types a consumer needs to implement `GatedConfig` or pass gates around are importable from public entry points.

## Changes

### Docs (H7)

- `src/core.ts:20-37` — rewrite the `buildGate` JSDoc example to the real API:
  - `gate({ key: "beta-access", defaultValue: false })`, not `providerGate("flag1", false)`
  - `betaAccess({ distinctId: "test-user" })` for identity override, not `betaAccess({ override: true })`
  - Show the variant form with `variants: ["light", "dark", "system"]`
- `README.md:125,145` — change `import { cacheHook } from "gated/hooks"` and `import { dedupeHook } from "gated/hooks"` to `gated/hooks/recipes`. Audit the rest of the README for the same drift (the `Decision` import in the cache example has no import statement — add one once exported).

### Type exports (H8 + Gate type)

- `src/index.ts` — additionally export:
  - `Decision` (type) from `./lib/types`
  - `Gate` (type) from `./core` — export the currently-private `interface Gate`
  - A named evaluator type, e.g. `type GateEvaluator<TIdentity, TValue> = (overrideIdentity?: TIdentity) => Promise<TValue>` in `src/lib/types.ts`, used by `Gate` and `createReactHook` instead of inline function types
- `src/hooks/recipes.ts` — `Cache` is already exported; confirm it appears in the built d.ts.

## Tests

- Add a type-level test file (e.g. `src/__tests__/exports.test.ts`) that imports `Decision`, `Gate`, `GateEvaluator`, `GatedConfig`, `Hook`, `HookContext`, `Identity` from `../index` and asserts assignability (compile-time; a trivial runtime assertion keeps bun test happy).

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- After build, `grep` the dist d.ts files to confirm `Decision` and `Gate` are exported from the root entry.

## Release

- Changeset: patch. "Export `Decision`, `Gate`, and `GateEvaluator` types from the root entry; fix incorrect import paths and outdated examples in docs."
