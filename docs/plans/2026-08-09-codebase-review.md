# Codebase Review — 2026-08-09 (Series B source)

Second full review of gated (v0.1.2, post plan series 01–14). Covers logic holes, API design, architecture, and testing on the current code. Findings F1–F4 were confirmed with executable repros against `src/`. This report is the reference for the **Series B** plans (`b00-overview.md` through `b13-*.md`); IDs here (F/A/W/T) are distinct from the 2026-08-06 review's H/API/arch numbering.

## 1. Confirmed logic holes (F1–F4 reproduced)

### F1. Recipe cache/dedupe keys are ambiguous — cross-flag collisions serve wrong decisions (reproduced)

`getKey` (src/hooks/recipes.ts:47) builds `` `${flagKey}:${distinctId}` `` with a bare `:` delimiter.

- Delimiter ambiguity: flag `"a:1"` + `distinctId: "2"` and flag `"a"` + `distinctId: "1:2"` both key to `"a:1:2"`. Repro: flag `"a"` returned flag `"a:1"`'s cached decision and never called its provider.
- Type coercion: `distinctId: 1` and `distinctId: "1"` collide (both allowed by `Identity`). Repro: the string-id evaluation received the numeric-id evaluation's cached decision.

Applies equally to `dedupeHook` (wrongly coalesced concurrent requests). The README's canonical cache example is a shared Redis store, so this is silent wrong-flag-value territory.

### F2. Recipe keys ignore every identity attribute except `distinctId` (reproduced)

A provider deciding on `identity.plan` cached `false` for `{distinctId: "u", plan: "free"}`; a later call overriding to `plan: "pro"` returned the stale `false` without reaching the provider. Any attribute-based targeting rule goes stale the moment attributes change mid-session.

### F3. Variant `defaultValue` is never validated at runtime (reproduced)

`gate({ key: "theme", defaultValue: "purple", variants: ["light", "dark"] })` is accepted at runtime (TypeScript-only enforcement); on fallback the gate returns `"purple"` — a value outside the declared variant set — while `validateDecision` (src/lib/index.ts:333) strictly rejects the same value from a provider or hook. Empty `key`, empty `variants`, and duplicate variant entries are also unchecked.

### F4. React `stableSerialize` silently collapses non-plain objects into identical cache keys (code-proven)

`stableSerialize` (src/integrations/react.tsx:196) walks only own enumerable keys: every `Date` serializes to `object:{}`, as do `Map`, `Set`, `URL`, and class instances. Symbols collapse by description, functions by name. Two identities differing only by such a value share one cache entry — wrong flag value, no error. `IdentityValue` permits objects and symbols, so the type system invites this; the serializer's `TypeError` branch is effectively unreachable.

## 2. Smaller gaps

- **F5.** `gate.batch([])` still resolves identity (src/lib/index.ts:568 onward) before discovering there are no entries.
- **F6.** In `anonymous: "allow"` mode a caller cannot force anonymous evaluation: `identify()` treats a `null` override as absent (src/lib/index.ts:114) and `GateCallOptions.identity` does not admit `null`.
- **F7.** `after` hooks are awaited on the hot path (src/lib/index.ts:494): `cacheHook`'s `cache.set` (a Redis write in the documented setup) adds its full latency to every provider-sourced evaluation.
- **F8.** Dedupe abort race: if a leader's deadline expires during its `after` hooks, error hooks reject the pending entry while the abandoned after-hook task can still resolve it concurrently — followers may receive the real decision while the leader reports a timeout. Benign but undocumented and untested nondeterminism.
- **F9.** `config.hooks` is captured by reference (src/lib/index.ts:382); mutating the array mid-evaluation skews `hookIndex` reporting and phase membership across phases.
- **F10.** Pending React cache entries are exempt from TTL/LRU by design; with no core timeout, a hung provider pins entries forever and the cache grows without bound under identity churn.
- **F11.** Custom React gate `invalidate` requires the full argument tuple, forcing fabricated operational args (`invalidate("account-1", "ignored-for-cache-key")`).

## 3. API design opportunities

- **A1. Typed variant payloads.** `payload?: IdentityValue` is semantically `unknown` wearing the wrong name; `IdentityValue` does triple duty (identity values, payloads, `normalizeError` input). Consumers must cast `details.payload` on every read.
- **A2. Per-evaluation hook state.** Stateful hooks correlate phases by using the live `HookContext` object as a WeakMap key — the "ownership token" pattern the code itself flags as load-bearing (src/lib/index.ts:397). Implicit contract third-party hook authors will get wrong; an explicit `context.state` bag would make it trivial and documentable.
- **A3. Failure observability without hooks.** Fail-soft means production fallbacks are invisible unless every call site uses `details()` or a hand-written error hook. A factory-level `onFallback(details)` — the gate-failure sibling of `onHookError` — makes telemetry a one-liner.
- **A4. Optional `identify` for per-request identity.** Server code that always passes `{ identity }` per call must still supply a dummy `identify`.
- **A5. Reactive flag updates.** Streaming providers (LaunchDarkly, PostHog) push changes; the TTL-plus-manual-invalidate model cannot express "flag flipped mid-session". A `subscribe` config plus a `useSyncExternalStore`-based React path is the largest feature-level differentiator available.
- **A6. Per-request React cache ergonomics.** The README's SSR example creates the request cache and hooks at what reads as module scope, contradicting its own "never share that cache across requests" warning. A context-provider-based injection fits SSR/RSC patterns better than per-request `createReactGate` calls.

## 4. Architecture wins

- **W1. Split `src/lib/index.ts` (725 lines).** Four separable concerns: signal/timeout plumbing, hook runners, the single-evaluation engine, the batch orchestrator. Also `core.ts` (public factory) vs `lib/index.ts` (engine) naming is opaque.
- **W2. Make the batch↔evaluation seam explicit.** `ExecutionOverrides` with `onPrepared(providerRequired)` and injected `provider: () => request.promise` has an implicit contract that lives only in call sites.
- **W3. Revisit dedupe-as-hook before 1.0.** The design survives via three backstops (owner token, `finally` rejection, `HookResolutionAbortError` laundering) spread across `recipes.ts` and `internal.ts`, plus a special-cased reporting rule. A first-class `coalesce` option in core would delete the internal-error channel and ownership machinery.

## 5. Testing

The suite is strong post-Series-A (hostile-hook fuzzing, real async Suspense tests, batch/dedupe deadlock integration tests). Remaining gaps map to the findings:

- **T1.** No tests for key-encoding collisions (F1), attribute staleness (F2), out-of-list `defaultValue` (F3), non-plain-object React keys (F4), empty `batch([])` (F5), or the dedupe abort race (F8). `stableSerialize` warrants property-based tests once its contract is explicit.

## Suggested priority

1. F1 + F4 (silent wrong values, cheap fixes) — b01, b03
2. F3/F5/F9 hardening — b02
3. F7 latency policy decision — b04
4. F2 stance (pluggable keys land in b01; staleness docs there too), F6, A1, A2, A3, A4 — b05–b09
5. W1/W2 refactor, then W3 spike — b10, b11
6. A5 reactive updates, A6 + F10 React SSR slice — b12, b13

## Repro artifacts

Cache key collision (`bun` against `src/`):

```ts
const store = new Map<string, Decision>()
const cache = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v) => {
    store.set(k, v)
  },
}
const gate1 = buildGate({
  identify: async () => ({ distinctId: "2" }),
  decide: async () => ({ type: "boolean", value: true }),
  hooks: [cacheHook(cache)],
})
await gate1({ key: "a:1", defaultValue: false })() // caches under "a:1:2"

const gate2 = buildGate({
  identify: async () => ({ distinctId: "1:2" }),
  decide: async () => ({ type: "boolean", value: false }),
  hooks: [cacheHook(cache)],
})
await gate2({ key: "a", defaultValue: false })() // → true from flag "a:1"'s cache; provider never called
```

Out-of-list default:

```ts
const g = buildGate({
  identify: async () => ({ distinctId: "u" }),
  decide: async () => {
    throw new Error("down")
  },
})
// @ts-expect-error JS consumer
await g({ key: "theme", defaultValue: "purple", variants: ["light", "dark"] })() // → "purple"
```

Attribute staleness:

```ts
const g = buildGate({
  identify: async () => ({ distinctId: "u", plan: "free" }),
  decide: async (_k, id) => ({ type: "boolean", value: id.plan === "pro" }),
  hooks: [cacheHook(cache)],
})
const pro = g({ key: "pro-feature", defaultValue: false })
await pro() // false, cached under "pro-feature:u"
await pro({ identity: { distinctId: "u", plan: "pro" } }) // → false (stale); provider never sees "pro"
```
