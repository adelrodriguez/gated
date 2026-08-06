# 10 — Decision discriminant + variant payloads

Delivers: API opportunity #5. Depends on: 03. Breaking (`Decision` shape).

## Goal

`Decision` is explicit and extensible. Providers can attach JSON payloads to variants (LaunchDarkly variation detail, PostHog payloads, Statsig dynamic configs).

## Design

```ts
// Before (src/lib/types.ts:11-15)
export type Decision = { value: boolean } | { variant: string }

// After
export type Decision =
  { type: "boolean"; value: boolean } | { type: "variant"; variant: string; payload?: unknown }
```

- All `"variant" in decision` checks (src/lib/index.ts:21,47; hooks/index tests) become `decision.type === "variant"`.
- Payload surfacing: add `payload` to `EvaluationDetails` (plan 07) for variant decisions. The plain call still returns just the variant string — payload access goes through `details()`. Typed payloads (generic over the variants map) are explicitly out of scope for this slice; leave a note in the plan for a future `variants: { light: PayloadT, ... }` design.
- Provide helper constructors to reduce provider boilerplate and ease migration:

  ```ts
  export const decision = {
    boolean: (value: boolean): Decision => ({ type: "boolean", value }),
    variant: (variant: string, payload?: unknown): Decision => ({
      type: "variant",
      variant,
      payload,
    }),
  }
  ```

## Changes

- `src/lib/types.ts`, `src/lib/index.ts` (`extractDecisionValue`/`validateDecision`), `src/hooks/recipes.ts` (Cache stores the new shape — flag this in the changeset: persisted caches with old-shape entries will fail the discriminant check; `cacheHook` should treat entries without `type` as misses).
- `src/index.ts` — export the `decision` helpers.
- README — update every `{ value: ... }` example; provider integration section shows payload usage.

## Tests

- Update all fixtures to the new shape.
- Old-shape cache entry (`{ value: true }`, no `type`) → treated as cache miss, overwritten (backward-compat for persisted caches).
- Payload round-trips through `details()`; absent payload is `undefined`.
- `@ts-expect-error`: old shape no longer assignable to `Decision`.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor (pre-1.0 breaking). "`Decision` now carries an explicit `type` discriminant and supports optional variant payloads. Use the new `decision.boolean()` / `decision.variant()` helpers. Persisted cache entries in the old shape are treated as misses."
