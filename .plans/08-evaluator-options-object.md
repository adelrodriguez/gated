# 08 — Evaluator options object

Delivers: API opportunity #3. No dependency on other slices (but coordinate with 07's `details` and 05's React props). Breaking (evaluator call signature).

## Goal

The evaluator's parameter is extensible. Identity override stops being a bare positional argument, making room for `signal` (plan 09) and future options without further breaks.

## Design

```ts
// Before
await betaAccess(overrideIdentity)

// After
await betaAccess({ identity: overrideIdentity })
await betaAccess() // unchanged

export type GateCallOptions<TIdentity extends Identity> = {
  identity?: TIdentity
  // signal?: AbortSignal   ← plan 09
}
```

## Changes

- `src/core.ts` / `src/lib/index.ts` — evaluator signature `(options?: GateCallOptions<TIdentity>) => Promise<TValue>`; `executeGate` reads `options?.identity` where it currently takes `overrideIdentity`.
- `src/lib/index.ts` `identify()` — unchanged semantics; note the existing truthiness check (lib/index.ts:7) becomes `!== undefined` while touching it.
- `details()` (plan 07) takes the same options type.
- React (`src/integrations/react.tsx`) — `createReactHook` passes `{ identity }`; `FeatureGate`'s `overrideIdentity` prop forwards as `{ identity: overrideIdentity }`. Optionally rename the prop to `identity` in the same break (recommended; one migration instead of two).
- Update every doc example (README testing section, JSDoc from plan 01).

## Migration note (for changeset)

```ts
// v0.x
await flag({ distinctId: "test-user" })
// new
await flag({ identity: { distinctId: "test-user" } })
```

Note the old form was also ambiguous: an identity object was structurally close to any options object we might add. The break is what makes plan 09 possible cleanly.

## Tests

- Update core tests using override identity (src/**tests**/core.test.ts:89-109 and friends) to the options form.
- `@ts-expect-error` test: passing a bare identity object no longer type-checks.
- React tests updated for the prop forwarding.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor (pre-1.0 breaking). "Gate evaluators now take an options object: `flag({ identity })` replaces `flag(identity)`."
