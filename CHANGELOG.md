# gated

## 0.2.0

### Minor Changes

- d9caee9: Add first-class caching, request coalescing, and provider change subscriptions.

  - Add `cache` and `onCacheError` gate factory options with the exported `DecisionCache`,
    `DecisionCacheOptions`, and `DecisionCacheErrorReport` types. Cache hits use the
    `"cache"` evaluation source and skip provider and batch work. Custom cache key function
    failures are reported as key operations with the gate flag key.
  - Add request coalescing with `buildGate({ coalesce: true })` and an optional custom key
    projection. Default coalescing keys include the gate kind and allowed variants so
    incompatible evaluators for one provider flag key do not share decisions.
  - Cache and coalescing keys are collision-safe: flag keys containing `:` and numeric versus
    string `distinctId` values do not collide. Persisted cache entries from earlier versions
    become cache misses.
  - Add `subscribe` to gate factory configuration and expose `gate.changes` for provider push
    updates. Changed flags are evicted from caches that support deletion.

- d9caee9: BREAKING: Rework the core evaluation API.

  - Decisions now use an explicit `type` discriminant. Replace `{ value }` with
    `decision.boolean(value)` and `{ variant }` with `decision.variant(variant, payload?)`.
    Malformed decisions fall back with a `MalformedDecisionError`. Persisted cache entries
    using the old shape are treated as misses and overwritten.
  - Gate evaluators now take an options object. Migrate `await flag({ distinctId })` to
    `await flag({ identity: { distinctId } })`.
  - Variant decisions support optional typed payloads. `Decision`, `EvaluationDetails`, and
    `GateEvaluator` gain defaulted payload parameters, so `details().payload` needs no casts.
  - Gates expose `details()` with the evaluated value, source (`"cache"`, `"provider"`, or
    `"default"`), flag key, and the underlying error when an evaluation fell back.
  - Add `decideMany` and `gate.batch()` for typed batch evaluation with per-flag lifecycle
    and evaluation-detail semantics.
  - Gate creation validates options at runtime: keys must be non-empty, variant lists must be
    non-empty and unique, and variant defaults must be declared variants. Empty batches no
    longer resolve identity.

- d9caee9: BREAKING: Redesign hooks as pure observers.

  - Hooks contain only `before`, `after`, `error`, and `finally` observers. Resolving hooks,
    hook context state, `createStateSlot`, `gated/hooks/recipes`, `cacheHook`, and
    `dedupeHook` are removed. Use the `cache` config for caching, `coalesce` for request
    coalescing, a closure `WeakMap` for cross-phase observer state, and a wrapper around
    `decide` for decision overrides.
  - Replace `createHook` with `defineHook`, which accepts either a direct hook object or a
    typed options factory.
  - Add `onHookError` to `GatedConfig` so hook failures in every lifecycle phase are reported
    instead of silently swallowed. Failures are normalized to `Error` before reaching `error`
    hooks or `onHookError`.
  - `after` hooks run detached after a decision commits, so slow observers no longer add
    evaluation latency. There is no drain operation: short-lived and serverless runtimes must
    not use `after` or `finally` for durable work.
  - `HookContext` exposes readonly gate metadata: a discriminated `kind`, `defaultValue`, and
    `variants` for variant gates. It accepts only the identity generic.
  - Each evaluation uses a fixed hook-list snapshot.
  - Export contextual `GatedError` subclasses for missing identities, decision mismatches,
    and invalid variants.

- d9caee9: Make identity resolution more flexible.

  - `identify` can be omitted from `buildGate` when every evaluator and batch call supplies
    `{ identity }`. Caller-identity factories require the identity in their call options.
  - Add anonymous allow mode so providers can evaluate a null identity while strict rejection
    remains the default. Anonymous-mode gates also accept `{ identity: null }` to force an
    anonymous evaluation for a single call or batch.
  - `GatedConfig` identify and decide functions can return synchronous values; the new
    `MaybePromise` utility type is exported. Normalize their return values with
    `Promise.resolve(...)` before chaining.
  - Identity metadata uses the exported `IdentityValue` union instead of an opaque index
    signature.

- d9caee9: BREAKING: Rework the React integration.

  - Rename `createReactHook` to `createReactGate`; no compatibility alias is provided.
    `createReactGate(gatedEvaluator)` remains configuration-free, while custom async
    functions must provide a semantic cache projection, for example
    `createReactGate(customAsyncGate, { cacheKey: (accountId) => accountId })`.
  - React gate evaluations use bounded per-identity TTL/LRU promise caching and expose
    `invalidate(identity?)`, `invalidateKey()`, and `clear()`. Cache keys are validated:
    non-plain objects, symbols, functions, bigints, and cycles throw a `TypeError` that names
    the invalid path.
  - Add `GateCacheProvider` for per-request cache injection and `pendingTtlMs` to bound
    never-settling evaluations.
  - React gates can re-render through `useSyncExternalStore` when their evaluator changes.
  - `FeatureGate` names its identity prop `identity` (previously `overrideIdentity`) and
    evaluates beneath its Suspense boundary so `loading` renders for async gates. String
    variant gates used without `match` render the fallback with a development warning.

- d9caee9: Add factory and per-gate timeouts plus caller abort signals with observable default
  fallbacks.

  Export `GateTimeoutError`, add the required `HookContext.signal`, and pass the combined
  signal to providers as the third `decide` argument. The provider options object is always
  present. Timeout values must be positive finite delays no greater than 2,147,483,647
  milliseconds. A deadline reached only while `finally` hooks are pending preserves the
  decision already returned.

  Consumers that construct `HookContext` objects in tests or custom harnesses must add a
  `signal`, such as `new AbortController().signal`.

### Patch Changes

- d9caee9: Publish compiled ESM and TypeScript declarations for every public entry point instead of
  exposing source TypeScript files. Export `Decision`, `GateFactory`, and `GateEvaluator`
  types from the root entry and fix outdated docs examples. Split the internal evaluation
  engine into signal, hook-runner, evaluation, and batch modules with no public API change.

## 0.1.2

### Patch Changes

- 5a05ff6: Reorganize source code structure by moving React integration to integrations directory

  - Moved React integration from `src/react.tsx` to `src/integrations/react.tsx` for better organization
  - Updated main entry point from `./index.ts` to `./src/index.ts` for consistency
  - Updated internal import paths to reflect new directory structure
  - No changes to public API - all package exports remain the same

## 0.1.1

### Patch Changes

- f55c30f: Update dev dependencies and pin dependency versions for better reproducibility
  - Updated @biomejs/biome from 2.2.6 to 2.3.0 for latest linting and formatting improvements
  - Updated adamantite from 0.11.1 to 0.12.0
  - Pinned all type definition packages (@types/bun, @types/react, @types/react-dom) and @testing-library/react to exact versions instead of using semver ranges
  - Pinned react-dom to 19.2.0 and added explicit react peer dependency constraint (^19.2.0)
  - Added "bump:deps" script for interactive dependency updates via Bun

## 0.1.0

### Minor Changes

- 3782af6: Initial release of Gated - a type-safe feature flag library for JavaScript and React applications

  This release introduces the core functionality for building flexible, type-safe feature flag systems with built-in hook support and React integration:

  **Core Features:**

  - `buildGate()` - Factory function for creating feature flag evaluators with custom identity and decision logic
  - Full TypeScript support with type-safe boolean flags and string variant flags
  - Extensible hook system for intercepting flag evaluation lifecycle (before, resolve, after, error, finally)

  **Built-in Hook Recipes:**

  - `cacheHook()` - Caches flag decisions per user to reduce provider API calls
  - `dedupeHook()` - Deduplicates concurrent requests for the same flag evaluation

  **React Integration:**

  - `createReactHook()` - Converts async gate functions into React hooks using React 19's `use()` primitive
  - `<FeatureGate>` - Component for conditionally rendering features based on flag evaluation with loading states and fallbacks

  The library is designed to be provider-agnostic, allowing integration with any feature flag service (LaunchDarkly, PostHog, custom solutions, etc.) while providing a consistent, type-safe API.
