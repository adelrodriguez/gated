<p align="center">
  <h1 align="center">🏰 Gated</h1>
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
    return { value: enabled }
  },
})

// Create type-safe feature flags
const betaAccess = gate({ key: "beta-access", defaultValue: false })
const newDashboard = gate({ key: "new-dashboard", defaultValue: false })

// Evaluate flags
const hasBetaAccess = await betaAccess() // false
const hasNewDashboard = await newDashboard() // true
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

### Hook System

Intercept the flag evaluation lifecycle with hooks. Gated supports five lifecycle stages:

- **`before`** - Runs before flag evaluation
- **`resolve`** - Can short-circuit evaluation by returning a decision
- **`after`** - Runs after every successful, validated decision and receives its provider source or the exact resolving hook
- **`error`** - Runs when evaluation throws an error
- **`finally`** - Always runs after evaluation completes

```typescript
import { createHook } from "gated"

// Create a custom logging hook
const loggingHook = createHook(() => ({
  before: async (context) => {
    console.log(`Evaluating flag: ${context.flagKey}`)
  },
  after: async (context, decision, meta) => {
    console.log(`Result for ${context.flagKey} from ${meta.source}:`, decision)
  },
  error: async (context, error) => {
    console.error(`Error evaluating ${context.flagKey}:`, error)
  },
}))

// Add hooks when building your gate
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [loggingHook()],
  onHookError: ({ phase, hookIndex, error }) => {
    console.error(`Hook ${hookIndex} failed during ${phase}`, error)
  },
})
```

Resolve-hook errors are skipped by default so later hooks or the provider can run. The bundled
dedupe hook internally re-surfaces a leader's gate failure to its followers so they do not retry
the provider independently.

#### Hook error handling

1. An ordinary hook failure never aborts evaluation and never changes the returned value.
2. Every ordinary hook failure in every phase is reported to `onHookError`. Reporting is fire-and-forget: synchronous throws and asynchronous rejections from `onHookError` are consumed, and the reporter never contributes to gate latency.
3. The bundled dedupe hook has an internal resolve-phase exception that re-surfaces a leader's underlying gate error and is not reported as a hook failure. This releases followers without triggering duplicate provider calls.
4. `error` hooks report _gate_ failures (identity/provider/validation); `onHookError` reports _hook_ failures. They do not overlap.

Consumer-facing library failures extend `GatedError` and use contextual classes so error hooks can
identify the failure without parsing messages: `IdentityNotFoundError`,
`DecisionTypeMismatchError`, and `InvalidVariantError`. These classes retain relevant details such
as the received decision, expected decision kind, and allowed variants. Internal hook-control
errors are intentionally not exported.

### Built-in Recipes

Two hook implementations are included:

#### Cache Hook

Caches flag decisions by identity:

```typescript
import type { Decision } from "gated"
import { cacheHook } from "gated/hooks/recipes"

const cache = {
  get: async (key: string) => await redis.get(key),
  set: async (key: string, value: Decision) => await redis.set(key, value),
}

// Add to your gate's hooks array
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [cacheHook(cache)],
})
```

#### Dedupe Hook

Deduplicates concurrent requests for the same flag:

```typescript
import { dedupeHook } from "gated/hooks/recipes"

// Add to your gate's hooks array
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [dedupeHook()],
})

// Only one API call will be made even with concurrent evaluations
const [result1, result2] = await Promise.all([betaFlag(), betaFlag()])
```

Recipe ordering can affect efficiency, but not correctness. For example, placing the cache hook before the dedupe hook may avoid creating a pending request for cache hits; either ordering is safe.
When several cache hooks are layered, each hook writes only if it was consulted and missed during
that evaluation. A hit in a later cache warms earlier caches, while a hit in an earlier cache does
not touch later caches that were never consulted.

### React Integration

React is currently the only framework with dedicated integration. The core library works in any JavaScript environment.

#### React Gates

Convert evaluators into cached React hooks with `createReactGate()`. Components calling these hooks directly must be wrapped in a Suspense boundary:

```typescript
import { createReactGate } from "gated/react"

// Using the gate from Quick Start
const betaFlag = gate({ key: "beta-access", defaultValue: false })
export const useBetaAccess = createReactGate(betaFlag)

// Use in components (wrapped in Suspense)
function MyComponent() {
  const hasBeta = useBetaAccess()
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

Evaluations are cached by identity for five minutes by default, with a maximum of 100 entries. Identities are treated as flat records and their values must be JSON-serializable. Configure the bounds and explicitly invalidate cached decisions when application state changes:

```typescript
const useBetaAccess = createReactGate(betaFlag, {
  maxEntries: 250,
  ttlMs: 60_000,
})

useBetaAccess.invalidate({ distinctId: user.id }) // One identity
useBetaAccess.invalidate() // The default identity
useBetaAccess.clear() // Every identity, for example on logout
```

Invalidation, clearing, and TTL expiry are not reactive: they cause re-evaluation on the next render but do not schedule a render themselves.

For server rendering, create and inject a cache for each React gate in each request. Never share a module-level cache across requests because it can retain identities and stale decisions across users:

```typescript
import { createReactGate, createReactGateCache } from "gated/react"

const requestCache = createReactGateCache<boolean>()
const useBetaAccess = createReactGate(betaFlag, { cache: requestCache })
```

#### `<FeatureGate>` Component

A convenience component for conditionally rendering children based on flag evaluation. Comes wrapped in a Suspense boundary to handle loading states:

```typescript
import { FeatureGate } from "gated/react";

function App() {
  return (
    <FeatureGate
      gate={useBetaAccess}
      loading={<Spinner />}
      fallback={<OldFeature />}
    >
      <BetaFeature />
    </FeatureGate>
  );
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
  decide: (key: string, identity: TIdentity) => Decision | Promise<Decision>,
  hooks?: Hook[]
})
```

Configuration functions may return their values directly or as promises. When calling them from
wrapper code, use `Promise.resolve(config.identify()).then(...)` before chaining promise methods.

Returns a gate factory function that creates individual feature flags.

#### Gate Factory

```typescript
// Boolean flag
gate({ key: string, defaultValue: boolean }): () => Promise<boolean>

// Variant flag
gate({
  key: string,
  defaultValue: T,
  variants: readonly T[]
}): () => Promise<T>
```

Optionally accepts `overrideIdentity` parameter for testing.

#### `createHook<TOptions>(factory)`

Creates a reusable hook with typed options. See Hook System section for lifecycle methods.

```typescript
const myHook = createHook((options: TOptions) => ({
  before?: (context: HookContext) => void | Promise<void>,
  resolve?: (context: HookContext) => Decision | undefined | Promise<Decision | undefined>,
  after?: (context: HookContext, decision: Decision) => void | Promise<void>,
  error?: (context: HookContext, error: unknown) => void | Promise<void>,
  finally?: (context: HookContext) => void | Promise<void>
}))
```

### React API

#### `createReactGate(gateFn, options?)`

Converts an evaluator into a React hook using React 19's `use()` primitive and a bounded per-identity promise cache. Options include `maxEntries`, `ttlMs`, and an injectable `cache`. The returned hook exposes `invalidate(identity?)` and `clear()`; these controls take effect on the next render.

#### `createReactGateCache(options?)`

Creates a bounded TTL/LRU cache for injection into `createReactGate`. Create one per server request when rendering on the server.

#### `<FeatureGate>`

Conditionally renders children based on flag evaluation. Includes built-in Suspense boundary.

**Props:** `gate`, `loading?`, `fallback?`, `overrideIdentity?`, `match?`

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

const ldClient = LaunchDarkly.initialize("client-id", { key: "user-key" })

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => ({ value: await ldClient.variation(key, false) }),
})
```

### PostHog

```typescript
import posthog from "posthog-js"

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => ({ value: posthog.isFeatureEnabled(key) }),
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
    return { value: (await res.json()).enabled }
  },
})
```

## Testing

Override identities when testing:

```typescript
const betaFlag = gate({ key: "beta-access", defaultValue: false })

// Test with specific identity
const result = await betaFlag({ distinctId: "test-user-123" })

// Or use a test gate with mocked decide function
const testGate = buildGate({
  identify: async () => ({ distinctId: "test" }),
  decide: async (key) => ({ value: key === "beta-access" }),
})
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
