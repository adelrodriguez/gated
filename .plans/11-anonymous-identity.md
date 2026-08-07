# 11 — Anonymous identity support

Delivers: API opportunity #6. Depends on: 03, 06, 07. Behavioral (opt-in; default preserves current behavior).

## Goal

Gates can evaluate for anonymous users instead of treating a null identity as a failure. Current behavior — `identify()` returning null throws "Identity not found" → default (src/lib/index.ts:13-15) — remains the default.

## Design

Opt-in at the factory level:

```ts
const gate = buildGate({
  identify, // may return null
  decide, // receives TIdentity | null when anonymous is allowed
  anonymous: "allow", // "reject" (default) | "allow"
})
```

- `anonymous: "reject"` (default): unchanged — null identity is an error, error hooks fire, default returned.
- `anonymous: "allow"`: evaluation proceeds with `identity: null`; `decide` and hooks receive `null`.
- Type-level: when `anonymous: "allow"`, `decide`'s identity parameter is `TIdentity | null`. Implement via `buildGate` overloads on the config literal type so the strict default keeps the non-null signature. If the conditional typing gets gnarly, fall back to `TIdentity | null` in `decide` only for the `"allow"` overload — never widen the default path.
- Recipe policy is explicit and conservative: `cacheHook` continues to bypass reads and writes when `identity === null`, so anonymous decisions are never retained or shared by default. `dedupeHook` may coalesce concurrent anonymous evaluations by flag key, but retains nothing after they settle. A future explicit `cacheHook(cache, { anonymous: "shared" })` option can enable flag-key-only anonymous caching if demand justifies it; it is out of scope here.

## Changes

- `src/lib/types.ts` / `src/core.ts` — `anonymous?: "reject" | "allow"` config + overloads.
- `src/lib/index.ts` — `identify()` returns `TIdentity | null` when allowed instead of throwing.
- README — anonymous evaluation section documenting cache bypass and in-flight-only anonymous deduplication.

## Tests

- Default config + null identity: existing behavior (default returned, error hooks fired) — assert unchanged.
- `anonymous: "allow"` + null identity: `decide` called with `null`; provider decision returned (not the default).
- `anonymous: "allow"` + resolved identity: identity passed through unchanged.
- `details()` for anonymous evaluation: `source: "provider"`, no error.
- Anonymous evaluation with `cacheHook`: no cache read or write; sequential calls consult the provider independently.
- Concurrent anonymous evaluations with `dedupeHook`: one provider call, all callers settle, and a later call starts a fresh evaluation.
- Compile-time: with default config, `decide: (key, identity: TIdentity) => ...` type-checks; with `"allow"`, a non-null-expecting `decide` is a type error.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Add `anonymous: 'allow'` to evaluate gates without a resolved identity; `decide` receives `null` in that mode. Default behavior unchanged."
