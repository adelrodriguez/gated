# Codebase Review — 2026-08-06

Full review of gated v0.1.1 covering logic holes, API design, architecture, and testing. Findings H1 and H2 were confirmed with executable repros. This report is the reference for the plan series in this directory (`01-*.md` through `14-*.md`).

## 1. Confirmed logic holes

### H1. `dedupeHook` + short-circuiting resolve hooks permanently hangs the gate (reproduced)

`executeGate` returns early when a resolve hook supplies a decision, skipping `after` hooks (src/lib/index.ts:151-153). `dedupeHook` registers its pending entry in `resolve` and only settles it in `after`/`error` (src/hooks/recipes.ts:80, 86-104). With `hooks: [dedupeHook(), cacheHook(cache)]` — a plausible ordering — the second call registers a pending entry, cache short-circuits, the entry never settles, and every subsequent call for that key awaits an orphaned promise forever. Repro: third call hangs indefinitely. The reverse ordering happens to work, but nothing documents or enforces that.

### H2. `FeatureGate`'s `loading` prop is dead code for async gates (reproduced)

The gate is invoked in an IIFE during `FeatureGate`'s own render (src/integrations/react.tsx:84-88). When `use()` suspends, it suspends `FeatureGate` itself — a component cannot be caught by a Suspense boundary it renders. The suspension escapes to an ancestor boundary; the `loading` fallback never shows. The test suite never caught this because every React test uses synchronous gates.

### H3. `createReactHook` creates an uncached promise on every render

`use(gateFn(overrideIdentity))` (src/integrations/react.tsx:40) produces a fresh promise per render: suspend → resolve → re-render → new promise → suspend again. Classic `use()` footgun ("uncached promise" warning); can loop indefinitely. Needs promise caching keyed by gate + identity.

### H4. `after` hooks run before decision validation

`runAfterHooks(decision)` fires, then `extractDecisionValue` may throw on a boolean/variant type mismatch (src/lib/index.ts:157-159). `cacheHook.after` has already cached the invalid decision — poisoning the cache so every future evaluation resolves the bad decision, throws, and falls to default.

### H5. Hook errors are invisible

`before`/`after`/`error`/`finally` failures are swallowed by `Promise.allSettled`; `resolve` failures by an empty `catch` (src/lib/index.ts:79-81). None are reported to `error` hooks. A permanently failing cache degrades silently with no observability path.

### H6. Callers can't distinguish "flag off" from "system down"

Every failure — identity missing, provider error, misconfiguration — collapses into `defaultValue` (src/lib/index.ts:160-166). Fine as a default posture, but there's no opt-in to see why (no result details, no throw mode).

### H7. Documentation drift (wrong public API in two places)

- `buildGate`'s JSDoc (src/core.ts:20-37) shows `providerGate("flag1", false)` and `betaAccess({ override: true })` — neither signature exists.
- README.md:125,145 says `import { cacheHook } from "gated/hooks"` — the actual entry point is `gated/hooks/recipes`.

### H8. `Decision` isn't exported from the root entry

Consumers must construct `Decision` objects in `decide` but can't import the type from `gated` (src/index.ts).

### H9. Type/runtime mismatch in `GatedConfig`

`types.ts:34-35` requires `identify`/`decide` to return promises, but the runtime accepts sync (src/lib/index.ts:4, 40), and `executeGate` re-declares its own wider config inline (src/lib/index.ts:124-128). Two sources of truth; sync consumers get a type error for code that works.

### H10. `match ?? true` breaks variant gates at runtime

The overloads force TS users to pass `match` for string gates, but a JS consumer (or `any`) omitting it silently compares `"dark" === true` and always renders fallback (src/integrations/react.tsx:86).

## 2. API design opportunities

- **Evaluation details (OpenFeature-style).** Expose `{ value, source: "hook" | "provider" | "default", error? }` — e.g., `betaFlag.details()` alongside the plain call. Solves H6 without complicating the happy path.
- **Enrich `HookContext`.** It carries only `flagKey` and `identity` (src/lib/types.ts:17-23). Hooks can't see `defaultValue`, `variants`, or gate kind — which is why `cacheHook` can serve a boolean decision to a variant gate. The unused `TOptions` generic is dead generality; replace with real metadata.
- **Options object on the evaluator.** `(overrideIdentity?) =>` should become `({ identity?, signal? }?) =>` — extensible for aborts/timeouts, stops conflating a test affordance with the primary calling convention.
- **Timeouts.** `defaultValue` covers rejection but not latency; a hung provider hangs the gate forever. A per-gate or per-build `timeoutMs` falling back to default is a big practical win.
- **`Decision` discriminant + payloads.** `"variant" in decision` checks are fragile; a `type` field is self-documenting and leaves room for variant payloads (most providers attach JSON to variants).
- **Anonymous identities.** `identify` returning null throws "Identity not found" → default (src/lib/index.ts:13-15). Most flag systems support anonymous evaluation; consider making it first-class rather than an error path.
- **Batch evaluation.** Providers typically return all flags in one call; per-gate `decide` forces N round-trips. A batch/`decideMany` concept fits the existing architecture.
- **Export the `Gate` type** (src/core.ts:4) and a named type for the returned evaluator — consumers can't currently type a gate they pass around.

## 3. Architecture wins

1. **Make the lifecycle uniform (highest leverage).** Run `after` (with a `source` tag) and validation in a consistent order regardless of whether the decision came from a hook or the provider. Fixes the entire H1 class of bugs, fixes H4, and makes hook ordering a performance concern instead of a correctness trap.
2. **Introduce an internal evaluation-result object.** `executeGate` threads loose locals (`identity`, `result`, rebuilt contexts at src/lib/index.ts:161,163). A small pipeline with one evaluation record unifies the config types (H9), feeds richer hook context, and makes the details API nearly free.
3. **Define a hook-error policy.** Hook failures should be reported (to `error` hooks or an `onHookError` config) but never abort evaluation. Right now behavior differs per phase and is entirely silent.
4. **Rework the React integration.** Cache promises keyed by gate + serialized identity; move `use()` into a child component rendered inside the Suspense boundary so `loading` actually works. Both H2 and H3 share this fix.
5. **Reconsider dedupe as a hook.** Request coalescing needs guaranteed settle-on-every-outcome, which the hook contract can't promise today. Either move into core as a config option, or (after win #1) settle in `finally` as a backstop.

## 4. Testing and maintainability

- **Volume without depth.** ~1,800 test lines, but many assert `typeof x === "function"`, `.name` prefixes, or `.length` (src/**tests**/react.test.tsx:9-59); `createHook`'s suite mostly re-tests that JS returns what you gave it. The four real bugs above were all reachable by tests that don't exist.
- **No integration tests of core + recipes.** Recipe tests invoke hook methods manually, re-implementing core's calling convention — they'd keep passing even if `executeGate` changed. The H1 hang lives precisely in that untested seam.
- **React tests never suspend.** All gates are sync. Need genuinely async gates asserting the loading fallback appears and no re-suspend loop occurs.
- **Missing hostile-hook tests.** A hook that throws in each phase; a resolve hook returning a mismatched decision type; a provider returning a variant not in the list after an `after` hook caches it.
- **Docs aren't verified.** H7's drift calls for an explicit LLM-assisted review of README/JSDoc examples against the public declarations and implementation whenever public behavior changes, plus targeted compile-time and behavioral tests for the most important public surfaces.

## Suggested priority

1. Lifecycle uniformity in `executeGate` (fixes H1/H4) — breaking-ish, do before 1.0
2. React integration rework (H2/H3 — integration currently unusable with real async gates)
3. Hook-error policy + evaluation details (H5/H6)
4. Type exports, config unification, doc fixes (H7-H9) — cheap, do immediately
5. Integration test suite covering core + recipes + React async

## Repro artifacts

**Dedupe hang** (`bun run` against src):

```ts
const gate = buildGate({
  identify: async () => ({ distinctId: "u1" }),
  decide: async () => ({ value: true }),
  hooks: [dedupeHook(), cacheHook(cache)], // dedupe before cache
})
const flag = gate({ key: "f", defaultValue: false })
await flag() // ok — populates cache
await flag() // ok — but orphans a pending dedupe entry
await flag() // hangs forever
```

**FeatureGate loading never shows** (bun test, happy-dom):

```tsx
const gateFn = () => new Promise<boolean>((r) => setTimeout(() => r(true), 50))
const useFlag = createReactHook(gateFn)
render(
  <FeatureGate gate={useFlag} loading={<div data-testid="loading">Loading</div>}>
    <div data-testid="feature">Feature</div>
  </FeatureGate>
)
// screen.queryByTestId("loading") → null while suspended (fallback escapes to ancestor)
```
