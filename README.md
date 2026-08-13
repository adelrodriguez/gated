<p align="center">
  <h1 align="center">🏰 <code>gated</code></h1>
  <p align="center">
    <strong>Type-safe feature flags for TypeScript applications</strong>
  </p>
</p>

**Gated** is a type-safe feature flag library for TypeScript applications. It provides a flexible API for evaluating feature flags with full type inference, a hook system for extending behavior, and framework integrations. Works on both client-side and server-side environments.

Gated works by wrapping your existing feature flag provider (LaunchDarkly, PostHog, custom, etc.) with a type-safe interface. You provide the identity resolution and decision logic, and Gated handles the evaluation flow with hooks for caching, deduplication, logging, and other cross-cutting concerns.

## Features

- ✅ **Type-safe** - Full TypeScript support with type inference for boolean and variant flags
- 🔌 **Provider-agnostic** - Works with any feature flag service (LaunchDarkly, PostHog, custom, etc.)
- 🪝 **Extensible hooks** - Create custom lifecycle hooks for caching, logging, analytics, and more
- ⚛️ **Framework integrations** - React hooks and components (React 19+ with `use()` primitive)
- 🌐 **Universal** - Works in both client-side and server-side environments
- 🎯 **Identity-based** - Evaluate flags for specific users with custom identity types
- 📦 **No runtime dependencies** - React is an optional peer dependency
- 🧪 **Testable** - Override identities and decisions for testing

## Installation

```bash
npm install gated
```

## Quick Start

```typescript
import { buildGate } from "gated"

// Create a gate factory with your provider's logic
const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key, identity) => {
    // Your provider's API call
    const enabled = await yourProvider.isEnabled(key, identity.distinctId)
    return { type: "boolean", value: enabled }
  },
})

// Create type-safe feature flags
const betaAccess = gate({ key: "beta-access", defaultValue: false })
const newDashboard = gate({ key: "new-dashboard", defaultValue: false })

// Evaluate flags
const hasBetaAccess = await betaAccess() // false
const hasNewDashboard = await newDashboard() // true
```

Provider decisions use an explicit discriminant. Helper constructors reduce adapter boilerplate and variants may carry an optional payload:

```typescript
import { decision } from "gated"

decision.boolean(true)
decision.variant("dark", { experiment: "checkout-theme" })
```

## Usage

### Boolean Flags

Boolean flags represent true/false feature toggles:

```typescript
// Using the gate from Quick Start
const darkMode = gate({ key: "dark-mode", defaultValue: false })

if (await darkMode()) {
  enableDarkMode()
}
```

### Variant Flags

String variants for A/B tests or multi-option features:

```typescript
const themeFlag = gate({
  key: "theme",
  defaultValue: "light", // Type-safe based on the variants array
  variants: ["light", "dark", "system"],
})

const theme = await themeFlag() // Type: "light" | "dark" | "system"
```

`defaultValue` must be one of the declared `variants`. Gate creation enforces this contract at runtime, including for JavaScript and untyped callers.

### Evaluation Details

Use `details()` when callers need to distinguish a legitimate value from a fallback caused by a provider or identity failure. Plain evaluation remains unchanged.

```typescript
const betaAccess = gate({ key: "beta-access", defaultValue: false })

const enabled = await betaAccess() // boolean
const details = await betaAccess.details()

if (details.source === "default") {
  alertOperations(details.error)
}
```

Details include the evaluated `value`, `flagKey`, and `source` (`"cache"`, `"provider"`, or `"default"`). When evaluation falls back because of a failure, `error` contains the underlying error. Like plain evaluation, `details()` accepts an optional call-options object and never rejects.

Variant details also expose the decision's optional `payload`; plain evaluation continues to return only the variant string. Declare the payload type when you create a variant gate so callers can read provider metadata without a cast:

```typescript
type ThemePayload = { experiment: string }

const theme = gate<ThemePayload>({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})

const themeDetails = await theme.details()
themeDetails.payload?.experiment // string | undefined
```

An undeclared variant payload is `unknown`. Boolean-gate details do not have a `payload` field. Payload declarations are type-only conveniences; Gated does not validate the payload shape at runtime.

#### Observing fallbacks

Use an error hook for telemetry when an evaluation returns its configured default because of a failure. The hook receives the evaluation context and the same error that appears in evaluation details. It runs once for each failed evaluator, including each failed entry in a batch.

```typescript
const telemetryHook = defineHook({
  error: ({ flagKey, identity, defaultValue }, error) => {
    telemetry.record("gate-fallback", { defaultValue, error, flagKey, identity })
  },
})

const gate = buildGate({
  identify,
  decide,
  hooks: [telemetryHook],
})
```

A successful hook or provider decision does not run the error hook, even when the decision equals the configured default. Use `onHookError` to report a hook that throws or rejects.

### Timeouts and Cancellation

Timeouts are opt-in and may be configured for every gate from a factory or overridden for one gate:

```typescript
const gate = buildGate({
  identify,
  decide: async (key, identity, { signal } = {}) => provider.evaluate(key, identity, { signal }),
  timeoutMs: 500,
})

const checkout = gate({
  key: "checkout",
  defaultValue: false,
  timeoutMs: 100,
})

const controller = new AbortController()
const details = await checkout.details({ signal: controller.signal })
```

A timeout or caller abort before a decision commits returns the configured default. The deadline covers identity resolution, `before` hooks, cache reads, the provider call, and decision validation. After a successful decision commits, `after` and `finally` hooks run as detached observers and do not add latency or consume the deadline. Error hooks finish before a fallback returns; `finally` then runs detached. Error hooks and `details().error` receive the original evaluation failure, a `GateTimeoutError`, or the caller signal's abort reason. The combined signal is available as `context.signal` in hooks and is passed to `decide`; work that ignores cancellation can finish in the background but cannot advance the operational gate lifecycle. Timeout values must be positive, finite, and no greater than 2,147,483,647 milliseconds.

### Anonymous Evaluation

Identity resolution remains strict by default: returning `null` is an error and the gate returns its default. Opt in when a provider supports anonymous subjects:

```typescript
import { decision } from "gated"

const gate = buildGate({
  anonymous: "allow",
  identify: (): UserIdentity | null => null,
  decide: (key, identity) => {
    // identity is UserIdentity | null
    return decision.boolean(provider.isEnabled(key, identity))
  },
})

const betaAccess = gate({ key: "beta-access", defaultValue: false })

// Skip identify() for this call and evaluate as an anonymous subject.
await betaAccess({ identity: null })
await gate.batch([betaAccess], { identity: null })
```

Hooks receive `context.identity === null`, and successful `details()` results retain `source: "provider"` without an error. Cache and request coalescing bypass anonymous evaluations, so decisions are neither retained nor shared between anonymous visitors.

The `{ identity: null }` override is available only for a factory with `anonymous: "allow"`. A strict factory does not accept it in TypeScript. If an untyped caller supplies it, the evaluation skips `identify()`, returns the configured default, and reports `IdentityNotFoundError` through `details().error`.

### Per-call Identity

Omit `identify` when every evaluator and batch receives its identity from the caller. This pattern is useful for servers and request handlers where identity is already available:

```typescript
const gate = buildGate<UserIdentity>({
  decide: (key, identity, { signal } = {}) => provider.evaluate(key, identity, { signal }),
})

const betaAccess = gate({ key: "beta-access", defaultValue: false })

await betaAccess({ identity: request.user })
await gate.batch([betaAccess], { identity: request.user })
```

In this mode, TypeScript requires an options object with `identity` for evaluator, `details()`, and `batch()` calls. If an untyped caller omits it, the evaluation returns its configured default and exposes `IdentityNotFoundError` through details and error hooks.

### Batch Evaluation

Provide `decideMany` to evaluate several gates in one provider round trip, then read their typed values synchronously from a batch. For example, a server-rendered page can evaluate everything it needs before rendering:

```typescript
const gate = buildGate({
  identify,
  decide,
  decideMany: (keys, identity, { signal } = {}) => provider.evaluateAll(keys, identity, { signal }),
})

const betaAccess = gate({ key: "beta-access", defaultValue: false })
const theme = gate({
  key: "theme",
  defaultValue: "light",
  variants: ["light", "dark"],
})

export async function DashboardPage() {
  const batch = await gate.batch([betaAccess, theme])
  const [beta, selectedTheme] = batch

  return renderDashboard({
    betaAccess: beta, // boolean
    theme: selectedTheme, // "light" | "dark"
    themeEvaluation: batch.details(theme), // source, error, and payload
  })
}
```

Batches resolve identity once and preserve each flag's hooks, validation, timeout, default, source, error, and variant-payload behavior. `batch.details(flag)` returns the same typed evaluation details as `flag.details()`. Cached keys are omitted from provider work. Ready cache misses are grouped into a batch. A missing batch result falls back to that flag's single `decide` call under that flag's own deadline; without `decideMany`, misses are evaluated in parallel. Calling `gate.batch()` therefore does not guarantee exactly one provider request. The signal passed to `decideMany` spans the batch and is aborted once the batch returns, so a provider call still in flight is cancelled. Batch keys must be unique.

An empty `gate.batch([])` returns an empty batch without resolving identity or calling a provider.

In anonymous mode, batches pass `null` to `decideMany`. Cache and request coalescing bypass anonymous evaluations, including concurrent batches.

Evaluation failures remain fail-soft and appear through `batch.details(flag)`. API misuse rejects batch creation: keys must be unique, every evaluator must come from the same gate factory, and call options use `{ identity }`. These cases throw `DuplicateBatchKeyError`, `ForeignGateEvaluatorError`, and the existing migration `TypeError`, respectively. Reading an evaluator that was not included throws `BatchFlagNotFoundError`.

### Hook System

Observe the flag evaluation lifecycle with hooks. Gated supports four lifecycle stages:

- **`before`** - Runs before flag evaluation
- **`after`** - Runs as a detached observer after every successful, validated decision and receives its `"cache"` or `"provider"` source
- **`error`** - Runs when evaluation throws an error
- **`finally`** - Runs as a detached observer after `after`, or after the error path completes

Every lifecycle method receives a readonly context describing the evaluation: `flagKey`, resolved `identity` (or `null` for anonymous and failed identity resolution), `kind` (`"boolean"` or `"variant"`), `defaultValue`, `variants` for variant gates, and the combined cancellation `signal`. The context is discriminated by `kind`, so checking it narrows `defaultValue` and makes `variants` available for variant gates.

The context object keeps the same reference through all phases of one evaluation. Use a closure
`WeakMap` when one hook must correlate work across phases:

```typescript
const starts = new WeakMap()

const timingHook = defineHook({
  before(context) {
    starts.set(context, performance.now())
  },
  after(context) {
    const startedAt = starts.get(context)
    starts.delete(context)
    recordLatency(performance.now() - startedAt)
  },
})
```

Do not clone the full context as a substitute for its lifecycle identity. Object spread creates a
different object and materializes live getters. Read the fields that your hook needs.

The hook list is fixed when an evaluation begins. A hook added to the factory configuration during an evaluation starts to run with the next evaluation.

The gate promise resolves when its decision commits. It does not wait for `after` or `finally`. These phases keep their order: all `after` hooks settle before `finally` hooks start. Do not depend on an `after` hook finishing before the caller receives the value. Gated does not expose a post-commit drain operation. In a short-lived or serverless runtime, use the provider path or another awaited operation for durable writes and telemetry; detached hook work can be interrupted when the runtime freezes or exits.

```typescript
import { defineHook } from "gated"

// Create a custom logging hook
const loggingHook = defineHook({
  before: async (context) => {
    console.log(`Evaluating flag: ${context.flagKey}`)
  },
  after: async (context, decision, meta) => {
    console.log(`Result for ${context.flagKey} from ${meta.source}:`, decision)
  },
  error: async (context, error) => {
    console.error(`Error evaluating ${context.flagKey}:`, error)
  },
})

// Add hooks when building your gate
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [loggingHook],
  onHookError: ({ phase, hookIndex, error }) => {
    console.error(`Hook ${hookIndex} failed during ${phase}`, error)
  },
})
```

#### Hook error handling

1. An ordinary hook failure never aborts evaluation and never changes the returned value.
2. Every ordinary hook failure in every phase is reported to `onHookError`. Reporting is fire-and-forget: synchronous throws and asynchronous rejections from `onHookError` are consumed, and the reporter never contributes to gate latency.
3. `error` hooks report _gate_ failures (identity/provider/validation); `onHookError` reports _hook_ failures. They do not overlap.

Consumer-facing library failures extend `GatedError` and use contextual classes so error hooks can
identify the failure without parsing messages: `IdentityNotFoundError`,
`DecisionTypeMismatchError`, `InvalidVariantError`, and `MalformedDecisionError`. These classes
retain relevant details such as the received decision, validation reason, expected decision kind,
and allowed variants.

### Request Coalescing

Concurrent evaluations for the same flag and identity share one provider call by default. Set
`coalesce: false` to give every evaluation its own provider call, for example when `decide` has
per-call side effects such as exposure logging:

```typescript
const gate = buildGate({
  coalesce: false,
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
})
```

Prefer tracking exposures in hooks: `after` hooks run once per evaluation, including for
evaluations that shared a coalesced provider call, so per-evaluation observability survives
coalescing.

Coalescing runs after cache reads, so cache hits do not create pending provider work. Both
coalescing and the cache identify interchangeable evaluations with the same [evaluation
key](#evaluation-key).

A follower's cancellation does not cancel the leader. If the leader is cancelled or fails, all
followers receive that same failure and run their own error hooks and fallback reporter. Anonymous
evaluations are not coalesced.

### First-class Cache

Set `cache` on a gate factory to cache decisions by identity:

```typescript
import type { Decision } from "gated"

const cache = {
  delete: async (key: string) => await redis.del(key),
  get: async (key: string) => await redis.get(key),
  set: async (key: string, value: Decision) => await redis.set(key, value),
}

const gate = buildGate({
  cache,
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
})
```

The engine treats a decision with the wrong shape or an unsupported variant as stale. It reports the failure to `onCacheError`, deletes the entry when `cache.delete` exists, and continues to the provider. Cache failures never fail an evaluation.

Cache stores own serialization and expiry. Variant payloads can contain values that are not JSON-safe. A persistent store must preserve or normalize them. Return `null` or `undefined` from `get` when an entry expires. Cache writes run after commit in the background. A short-lived runtime can stop before a write finishes.

Decisions are stored under the [evaluation key](#evaluation-key), which is shared with request
coalescing.

`onCacheError` receives `operation`, `key`, `flagKey`, `identity`, and the normalized `error`.
Reporting is fire-and-forget.

### Evaluation Key

The evaluation key is the collision-safe string that the cache and request coalescing use to
identify interchangeable evaluations. By default it contains the flag key, gate kind, configured
variant list for variant gates, and the type and value of `distinctId`. Evaluators with one
provider flag key but incompatible decision shapes therefore never share decisions. The key does
not include other identity attributes. Set `evaluationKey` when targeting uses such attributes:

```typescript
const gate = buildGate({
  cache,
  coalesce: true,
  evaluationKey: (context) =>
    JSON.stringify([context.flagKey, context.identity?.distinctId, context.identity?.plan]),
  identify: async () => ({ distinctId: userId, plan }),
  decide: async (key, identity) => provider.evaluate(key, identity),
})
```

A custom projection fully replaces the default key, including its gate-shape fields. It can
therefore deliberately share decisions across shapes; the projection must only return the same
key when the provider decision is compatible with every matching evaluator.

A throwing `evaluationKey` never fails the evaluation: the error is reported through
`onCacheError` with operation `"key"` — even when only coalescing is configured — and the
evaluation continues without cache or coalescing.

### Reactive Updates

Provider adapters can send flag changes through a factory-level change hub. The provider subscription starts when the first `gate.changes` listener attaches and stops when the last listener detaches. Send `keys` to identify changed flags, or omit it when all flags can have changed:

```typescript
const gate = buildGate({
  cache,
  decide,
  identify,
  subscribe(notify) {
    const handleChange = (changes: Record<string, unknown>) => {
      notify({ keys: Object.keys(changes) })
    }

    ldClient.on("change", handleChange)
    return () => ldClient.off("change", handleChange)
  },
})
```

When both `cache.delete` and `subscribe` exist, the engine indexes evaluated cache keys by flag and deletes entries affected by a notification. Other flag entries stay cached. If either function is absent, entries remain until the store expires them.

A notification also drops in-flight coalesced provider work for the changed flags whenever `subscribe` is set, with or without a cache. Evaluations already awaiting the shared call keep its decision; evaluations that start after the notification lead a fresh provider call.

A notification also invalidates every pending cache write, regardless of which flags changed, so a decision fetched before the change is never written to the store after it — even when the store cannot delete. Pending writes live only for the duration of a provider call and the next evaluation re-establishes them, so the engine prefers dropping a write over tracking which flags a notification covers. The invalidation subscription attaches on the first evaluation that touches cache or coalescing and stays attached for the factory's lifetime. A `subscribe` function that throws never fails an evaluation: the error is reported through `onCacheError` with operation `"subscribe"`, and the evaluation continues without invalidation.

Core evaluation remains pull-based. Subscribe directly to `gate.changes` when another integration or application store needs notifications:

```typescript
const unsubscribe = gate.changes.subscribe((keys) => {
  refreshFlags(keys)
})
```

### React Integration

React is currently the only framework with dedicated integration. The core library works in any JavaScript environment.

#### React gates

Pass evaluators directly to `useGate()`. Components calling gate hooks must be wrapped in a Suspense boundary:

```typescript
import { useGate } from "gated/react"

// Using the gate from Quick Start
const betaFlag = gate({ key: "beta-access", defaultValue: false })

// Use in components (wrapped in Suspense)
function MyComponent() {
  const hasBeta = useGate(betaFlag)
  return hasBeta ? <BetaFeature /> : <OldFeature />
}

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <MyComponent />
    </Suspense>
  )
}
```

Evaluations are cached by gate and identity for five minutes after they settle, with a maximum of 100 settled entries per gate. Each evaluator, each batch tuple, and the function form of `useGate` hold their own bucket, so `maxEntries` bounds identities within a bucket rather than the cache as a whole. Pending evaluations stay pinned by default, so the cache can temporarily exceed that bound without causing repeated Suspense retries. Set `pendingTtlMs` to make older pending entries evictable, or configure a core gate `timeoutMs` so evaluations cannot remain pending indefinitely. Eviction only removes the cache reference; it does not cancel the in-flight promise. The default pending behavior is unchanged. Identity cache-key inputs are validated at render. They can contain only strings, numbers, booleans, `null`, `undefined`, arrays, and string-keyed plain records composed recursively from those values. Non-plain objects such as `Date` and `Map`, symbols, functions, bigints, and circular references throw a `TypeError` that names the invalid path. Change `identify` to stringify or project unsupported identity values. Configure the bounds and explicitly invalidate cached decisions when application state changes:

```tsx
const cache = createGateCache({ maxEntries: 250, pendingTtlMs: 30_000, ttlMs: 60_000 })

function App() {
  return (
    <GateProvider cache={cache} identity={{ distinctId: user.id }}>
      <Routes />
    </GateProvider>
  )
}
```

Invalidation and clearing evict entries and re-render subscribed components. Provider change notifications are connected automatically. A matching notification re-evaluates the gate; notifications for other flag keys do not render the component.

```tsx
function RefreshButton() {
  const cache = useGateCache()
  // Defaults to the provider identity, so this evicts the entry the tree is reading.
  return <button onClick={() => cache.invalidate(betaFlag)}>Refresh</button>
}
```

A cache read through `useGateCache()` applies the provider identity to `invalidate`, `invalidateBatch`, `prefetch`, and `prefetchBatch` when the call omits one. A cache used directly, outside React, has no provider to read, so it always requires an explicit identity: `cache.invalidate(betaFlag, { distinctId: user.id })`.

Every `gated/react` export is client-only; the module carries a `"use client"` directive. Achieve per-request isolation on the server by mounting `GateProvider` inside the client boundary rather than by constructing a cache in a Server Component.

For server rendering, mount `GateProvider` above the Suspense boundaries that contain its consumers. A bare provider creates an isolated cache per mount. Client-only applications do not need a provider.

The change subscription is client-oriented. `useSyncExternalStore` does not attach it during a server render, so a request-scoped server render does not open a provider listener.

```tsx
import { GateProvider } from "gated/react"

function createRequestTree() {
  return (
    <GateProvider>
      <App />
    </GateProvider>
  )
}

// Call once for each server request, then pass the tree to the server renderer.
const requestTree = createRequestTree()
```

Use `useGateCache()` inside a component to access the active cache. Pass an explicit cache to `GateProvider` when code outside React also needs the cache reference.

Pass identity in the hook options: `useGate(betaFlag, { identity })`. Use the core evaluator directly when a caller-owned signal is required.

Custom async functions use `useGate(fn, { key })`. The required key is a scalar, array, or string-keyed plain record. Custom functions have no automatic changes feed or identity fallback.

```typescript
const customAsyncGate = async (accountId: string, traceId: string) =>
  provider.evaluateAccount(accountId, { traceId })
const enabled = useGate(() => customAsyncGate("account-1", crypto.randomUUID()), {
  key: "account-1",
})
cache.invalidateKey("account-1")
```

#### `<FeatureGate>` Component

A convenience component for conditionally rendering children based on flag evaluation. When `loading` is provided, the component adds a Suspense boundary with that fallback. When it is omitted, suspension propagates to the nearest ancestor boundary:

```typescript
import { FeatureGate } from "gated/react"

function App() {
  return (
    <FeatureGate
      gate={betaFlag}
      loading={<Spinner />}
      fallback={<OldFeature />}
    >
      <BetaFeature />
    </FeatureGate>
  )
}
```

For variant flags, `match` is required and specifies the expected value. Omitting it from JavaScript renders the fallback and logs a development warning. Boolean flags default to matching `true`.

## API Reference

### Core API

#### `buildGate<TIdentity>(config)`

Creates a gate factory function for evaluating feature flags.

```typescript
const gate = buildGate({
  identify: () => TIdentity | null | Promise<TIdentity | null>,
  decide: (key: string, identity: TIdentity, options?: { signal?: AbortSignal }) =>
    Decision | Promise<Decision>,
  decideMany?: (keys: readonly string[], identity: TIdentity, options?: { signal?: AbortSignal }) =>
    Record<string, Decision> | Promise<Record<string, Decision>>,
  hooks?: Hook[],
  onHookError?: (report: HookErrorReport<TIdentity>) => void | Promise<void>,
  timeoutMs?: number,
  anonymous?: "reject"
})
```

Configuration functions may return their values directly or as promises. When calling them from
wrapper code, use `Promise.resolve(config.identify()).then(...)` before chaining promise methods.
Strict identity resolution is the default; `anonymous: "reject"` may also be specified explicitly.
The anonymous overload uses `anonymous: "allow"` and widens provider identities to include `null`:

```typescript
const anonymousGate = buildGate({
  anonymous: "allow",
  identify: () => TIdentity | null | Promise<TIdentity | null>,
  decide: (key: string, identity: TIdentity | null, options?: { signal?: AbortSignal }) =>
    Decision | Promise<Decision>,
  decideMany?: (
    keys: readonly string[],
    identity: TIdentity | null,
    options?: { signal?: AbortSignal }
  ) => Record<string, Decision> | Promise<Record<string, Decision>>
})
```

The caller-identity overload omits `identify` and requires `{ identity }` on every evaluation and batch:

```typescript
const requestGate = buildGate<TIdentity>({
  decide: (key: string, identity: TIdentity, options?: { signal?: AbortSignal }) =>
    Decision | Promise<Decision>,
  decideMany?: (keys: readonly string[], identity: TIdentity, options?: { signal?: AbortSignal }) =>
    Record<string, Decision> | Promise<Record<string, Decision>>,
  hooks?: Hook[],
  onHookError?: (report: HookErrorReport<TIdentity>) => void | Promise<void>,
  timeoutMs?: number,
})
```

Returns a gate factory function that creates individual feature flags.

#### Gate Factory

```typescript
// Boolean flag — the evaluator is callable and also exposes details()
gate({ key: string, defaultValue: boolean }): GateEvaluator<TIdentity, boolean>

// Variant flag with an optional declared payload type
gate<TPayload = unknown>({
  key: string,
  defaultValue: T,
  variants: readonly T[]
}): GateEvaluator<TIdentity, T>

type GateEvaluator<
  TIdentity extends Identity,
  TValue extends boolean | string,
  TCallIdentity extends TIdentity | null = TIdentity,
  TPayload = unknown,
  TCallRequired extends boolean = false,
> = ((options?: GateCallOptions<TCallIdentity>) => Promise<TValue>) & {
  details(options?: GateCallOptions<TCallIdentity>): Promise<EvaluationDetails<TValue, TPayload>>
}

type GateCallOptions<TCallIdentity extends Identity | null> = {
  identity?: TCallIdentity
  signal?: AbortSignal
}

gate.batch(flags, options?): Promise<GateBatch<typeof flags>>
```

Caller-identity factories set `TCallRequired` and require call options with a non-optional `identity`. Other factory modes keep call options optional.

See [Evaluation Details](#evaluation-details) for the result shape returned by `details()`.
Standard evaluators and `details()` accept `{ identity?, signal? }`; caller-identity evaluators require `{ identity, signal? }`. `details()` reports source, fallback errors, and variant payloads without rejecting. `batch()` resolves identity once and returns typed synchronous `get()` reads after evaluation completes.

#### `defineHook(hook)` / `defineHook<TOptions>(factory)`

Defines a hook directly or a reusable hook factory with typed options. A direct hook object is shared by every gate it is registered on, so its closure state is shared too; each factory invocation produces a fresh hook with isolated state. Prefer the factory form when the hook holds mutable state. See Hook System for lifecycle methods.

```typescript
const loggingHook = defineHook({
  before: (context) => console.log(context.flagKey),
})

type PrefixOptions = { prefix: string }

const prefixedHook = defineHook((options: PrefixOptions) => ({
  before: (context) => console.log(`${options.prefix}:${context.flagKey}`),
  after: (context, decision, metadata) => {
    console.log(context.flagKey, decision, metadata.source) // "cache" | "provider"
  },
}))

const auditHook = prefixedHook({ prefix: "audit" })
```

### React API

#### `useGate(evaluator, options?)`

Reads an evaluator through React 19 `use()`. Options are `identity`, `ttlMs`, and `details`. The function form is `useGate(fn, { key, ttlMs? })` and requires a stable key.

#### `useGateBatch(flags, options?)`

Evaluates one tuple of gates with one suspension and one provider `decideMany` call when available. Flag order is part of the cache key and result tuple.

#### `createGateCache(options?)` and `useGateCache()`

Creates or reads the bounded active cache. It provides `invalidate`, `invalidateBatch`, `invalidateKey`, `clear`, `prefetch`, and `prefetchBatch`. Prefetch uses the same entries as the hooks, so client-side navigation handlers and hover handlers can start work before render. A cache reached through `useGateCache()` falls back to the provider identity; a directly constructed cache has no provider to read and always needs an explicit identity. Both exports are client-only.

#### `<GateProvider>`

Creates an isolated cache per mount or accepts an explicit cache. It can also provide a default identity. Mount it above consumer Suspense boundaries.

#### `<FeatureGate>`

Conditionally renders children based on flag evaluation. Adds a Suspense boundary when `loading` is provided; otherwise it uses the nearest ancestor boundary.

**Props:** `gate`, `loading?`, `fallback?`, `identity?`, `match?`

## TypeScript Support

Gated provides full type inference for variant flags and supports custom identity types:

```typescript
// Custom identity types
interface UserIdentity extends Identity {
  distinctId: string
  email: string
  plan: "free" | "pro" | "enterprise"
}

const gate = buildGate<UserIdentity>({
  identify: async () => ({
    distinctId: user.id,
    email: user.email,
    plan: user.plan,
  }),
  decide: async (key, identity) => {
    // identity is fully typed as UserIdentity
    return provider.evaluate(key, identity)
  },
})
```

Variant flag return types are automatically inferred from the `variants` array (see Variant Flags section).

## Provider Integration

Gated works with any feature flag provider by implementing the `decide` function:

### LaunchDarkly

```typescript
import * as LaunchDarkly from "launchdarkly-js-client-sdk"
import { decision } from "gated"

const ldClient = LaunchDarkly.initialize("client-id", { key: "user-key" })
type ThemePayload = Awaited<ReturnType<(typeof ldClient)["variationDetail"]>>

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => {
    const detail = await ldClient.variationDetail(key, "control")
    return decision.variant(detail.value, detail)
  },
})

const theme = gate<ThemePayload>({
  defaultValue: "control",
  key: "theme",
  variants: ["control", "dark"],
})

await theme.details()
```

### PostHog

```typescript
import posthog from "posthog-js"

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => ({ type: "boolean", value: posthog.isFeatureEnabled(key) ?? false }),
})
```

### Custom API

```typescript
const gate = buildGate({
  identify: async () => ({
    distinctId: user.id,
    email: user.email,
    country: user.country,
  }),
  decide: async (key, identity) => {
    const res = await fetch(`/api/features/${key}`, {
      method: "POST",
      body: JSON.stringify(identity),
    })
    return { type: "boolean", value: (await res.json()).enabled }
  },
})
```

## Testing

Override identities when testing:

```typescript
const betaFlag = gate({ key: "beta-access", defaultValue: false })

// Test with specific identity
const result = await betaFlag({ identity: { distinctId: "test-user-123" } })

// Or use a test gate with mocked decide function
const testGate = buildGate({
  identify: async () => ({ distinctId: "test" }),
  decide: async (key) => ({ type: "boolean", value: key === "beta-access" }),
})
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
