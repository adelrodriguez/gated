# b09 — Optional `identify` for per-call identity

Fixes: A4. Depends on: b05 (identity override semantics settled first). Additive overload.

## Goal

A factory used exclusively with per-call identities (the server/per-request pattern the README itself demonstrates) does not need a dummy `identify`, and the types enforce that its evaluators are always called with one.

## Problem

`identify` is required by `GatedConfig`, so per-request server code writes `identify: () => { throw new Error("always pass identity") }` or an arbitrary stub. The stub can mask bugs: forgetting `{ identity }` silently evaluates the stub identity instead of failing.

## Design

Add a third config shape (mirroring how `AnonymousGatedConfig` works) selected by omitting `identify`:

```ts
const gate = buildGate({
  decide: (key, identity) => provider.evaluate(key, identity),
})

await betaFlag({ identity }) // required by the types
await betaFlag() // type error; at runtime: IdentityNotFoundError → default + onFallback
```

- New `CallerIdentityGatedConfig<TIdentity>`: `GatedConfig` minus `identify`, `anonymous` not permitted (anonymous mode already models "no identity"; combining the two is redundant — revisit only if a real use case appears).
- The factory type gains a mode that makes call options required with a required `identity` field: `GateEvaluator`'s options parameter becomes non-optional for this mode. Thread via the same factory type parameter introduced in b05 (`GateFactory<TIdentity, TCallIdentity>` grows a `TCallRequired` flag or a union mode type — pick whichever keeps the public surface readable; the overloads should stay the visible API).
- Runtime: `identify` internal helper already handles the override-first path; when config has no `identify` and no override is present, throw `IdentityNotFoundError` (existing fallback machinery handles the rest — default value, error hooks, `details().error`, b08's `onFallback`).
- `gate.batch` in this mode requires `{ identity }` in its options the same way.

## Changes

- `src/lib/types.ts` — `CallerIdentityGatedConfig`; call-options/required-ness plumbing on evaluator types.
- `src/core.ts` — third `buildGate` overload; `identify` access sites use `config.identify?.` with the missing-identity throw.
- `src/lib/index.ts` — `identify()` helper accepts an absent resolver.
- README — Quick Start unchanged; add a "Per-call identity" subsection under Usage and the config variant to the API Reference.

## Tests

- `src/__tests__/core.test.ts` — evaluator with `{ identity }` works; runtime call without identity returns default with `IdentityNotFoundError` in `details()`; batch respects the required identity.
- Type-level (`test/package-exports/consumer.ts`) — omitting `identify` compiles; calling its evaluator without options is a type error; providing both `identify` and this mode's expectations doesn't regress the two existing config shapes (all three overloads still resolve).

## Verification

- `bun test`, `bun run check:exports`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "`identify` may be omitted from `buildGate` when every call supplies `{ identity }`; the types then require it per call."
