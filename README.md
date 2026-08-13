<p align="center">
  <h1 align="center">🏰 <code>gated</code></h1>
  <p align="center">
    <strong>Type-safe feature flags for TypeScript applications.</strong>
  </p>
</p>

<p align="center">
  Use one API with LaunchDarkly, PostHog, or your own feature flag provider.
</p>

Gated adds a type-safe evaluation layer to your feature flag provider. You supply the
identity and provider decision. Gated manages validation, fallback values, hooks,
caching, request coalescing, batches, and timeouts.

Gated works in browsers and servers. React support is available as an optional entry
point.

## Features

- **Type-safe gates:** Infer boolean and string variant values in TypeScript.
- **Provider-independent API:** Connect any provider through one `decide` function.
- **Safe fallback behavior:** Return the configured default when evaluation fails.
- **Evaluation details:** Inspect the decision source, payload, and fallback error.
- **Efficient evaluation:** Cache decisions, coalesce requests, or evaluate a batch.
- **Lifecycle hooks:** Observe evaluation without changing its result.
- **React support:** Use gates with React 19, Suspense, and a bounded gate cache.
- **No core runtime dependencies:** Install React only when your application needs it.

## Install Gated

```sh
bun add gated
```

You can also use npm, pnpm, or Yarn.

## Create your first gate

First, create a gate factory. The factory connects Gated to your identity source and
feature flag provider.

```typescript
import { buildGate, decision } from "gated"

const gate = buildGate({
  identify: () => ({ distinctId: getCurrentUserId() }),
  decide: async (key, identity) => {
    const enabled = await provider.isEnabled(key, identity.distinctId)
    return decision.boolean(enabled)
  },
})
```

Next, create and evaluate a boolean gate:

```typescript
const betaAccess = gate({
  key: "beta-access",
  defaultValue: false,
})

if (await betaAccess()) {
  showBetaFeatures()
}
```

`betaAccess()` returns `false` if identity resolution or provider evaluation fails.
This fail-soft behavior lets your application continue with a known value.

## Use boolean and variant gates

### Boolean gates

A boolean gate returns `true` or `false`:

```typescript
const darkMode = gate({
  key: "dark-mode",
  defaultValue: false,
})

const enabled = await darkMode() // boolean
```

### Variant gates

A variant gate returns one value from a fixed list:

```typescript
const theme = gate({
  key: "theme",
  defaultValue: "light",
  variants: ["light", "dark", "system"],
})

const selectedTheme = await theme() // "light" | "dark" | "system"
```

The default value must be in `variants`. Gated checks this requirement at runtime and
TypeScript checks it during development.

Provider decisions have an explicit type. You can return decision objects directly or
use the helper functions:

```typescript
import { decision } from "gated"

decision.boolean(true)
decision.variant("dark", { experiment: "checkout-theme" })
```

## Inspect evaluation details

Call `details()` when you need more than the returned value:

```typescript
const result = await betaAccess.details()

console.log(result.value)
console.log(result.flagKey)
console.log(result.source) // "cache" | "provider" | "default"

if (result.source === "default") {
  reportEvaluationError(result.error)
}
```

Like normal evaluation, `details()` does not reject. It returns the default value and
the original error when evaluation fails.

Variant details can also include a provider payload. Declare its type when you create
the gate:

```typescript
type ThemePayload = {
  experiment: string
}

const theme = gate<ThemePayload>({
  key: "theme",
  defaultValue: "light",
  variants: ["light", "dark"],
})

const result = await theme.details()
result.payload?.experiment // string | undefined
```

Gated does not validate payload data at runtime. If you do not declare a payload type,
the payload type is `unknown`.

## Supply an identity

Each identity must have a `distinctId`. You can resolve the identity in the gate factory
or supply it for each call.

### Resolve the identity in the factory

Use `identify` when the application has a shared identity source:

```typescript
const gate = buildGate({
  identify: () => ({ distinctId: session.userId }),
  decide: (key, identity) => provider.evaluate(key, identity),
})
```

You can override the resolved identity for one evaluation:

```typescript
await betaAccess({ identity: { distinctId: "test-user" } })
```

### Supply the identity for each call

Omit `identify` when the caller already has the identity. This pattern is useful in
servers and request handlers:

```typescript
type UserIdentity = {
  distinctId: string
  plan: "free" | "pro"
}

const gate = buildGate<UserIdentity>({
  decide: (key, identity, { signal } = {}) => provider.evaluate(key, identity, { signal }),
})

const checkout = gate({ key: "checkout", defaultValue: false })

await checkout({ identity: request.user })
```

TypeScript requires an identity for each evaluator, `details()`, and `batch()` call in
this mode.

### Allow anonymous evaluation

Identity resolution is strict by default. Set `anonymous: "allow"` only when your
provider supports anonymous subjects:

```typescript
const gate = buildGate({
  anonymous: "allow",
  identify: (): UserIdentity | null => null,
  decide: (key, identity) => provider.evaluate(key, identity),
})

const landingPage = gate({ key: "landing-page", defaultValue: false })

await landingPage({ identity: null })
```

Gated does not cache or coalesce anonymous evaluations.

## Evaluate a batch

Use `batch()` when one operation needs several gates. A batch resolves the identity once.
Add `decideMany` when your provider has a batch API:

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

const result = await gate.batch([betaAccess, theme])
const [hasBetaAccess, selectedTheme] = result

result.details(theme)
```

The returned tuple is type-safe and synchronously readable. Each gate keeps its own
hooks, validation, timeout, fallback value, and details.

A batch does not always make one provider request. Cache hits do not go to the provider.
If `decideMany` omits a key, Gated calls `decide` for that key. If you do not supply
`decideMany`, Gated evaluates cache misses in parallel.

All batch keys must be unique, and all evaluators must come from the same gate factory.

## Set timeouts and cancel evaluations

Set a timeout on the factory or on one gate:

```typescript
const gate = buildGate({
  identify,
  decide: (key, identity, { signal } = {}) => provider.evaluate(key, identity, { signal }),
  timeoutMs: 500,
})

const checkout = gate({
  key: "checkout",
  defaultValue: false,
  timeoutMs: 100,
})
```

Use an `AbortSignal` to cancel one call:

```typescript
const controller = new AbortController()

const pendingResult = checkout.details({ signal: controller.signal })
controller.abort()

const result = await pendingResult
```

A timeout or cancellation returns the configured default if no decision has committed.
The signal is available to hooks and provider functions.

Timeouts cover identity resolution, `before` hooks, cache reads, provider work, and
decision validation. The `after` and `finally` hooks run after a successful commit and do
not add evaluation latency.

## Observe evaluations with hooks

Hooks observe four lifecycle phases:

- `before`: Runs before the cache and provider work.
- `after`: Runs after a valid cache or provider decision commits.
- `error`: Runs when evaluation fails and returns the default.
- `finally`: Runs after the success or error path.

```typescript
import { defineHook } from "gated"

const telemetryHook = defineHook({
  before: (context) => {
    telemetry.start(context.flagKey)
  },
  after: (context, providerDecision, metadata) => {
    telemetry.success(context.flagKey, metadata.source)
  },
  error: (context, error) => {
    telemetry.failure(context.flagKey, error)
  },
  finally: (context) => {
    telemetry.finish(context.flagKey)
  },
})

const gate = buildGate({
  identify,
  decide,
  hooks: [telemetryHook],
  onHookError: ({ phase, hookIndex, error }) => {
    reportHookError({ phase, hookIndex, error })
  },
})
```

Hook failures do not stop evaluation and do not change the result. `onHookError` reports
hook failures. An `error` hook reports evaluation failures.

The `after` and `finally` phases are detached observers. The evaluator does not wait for
them. Do not use these phases for work that must finish before a serverless runtime exits.

Each hook receives one read-only context for the full evaluation. The context contains
the flag key, identity, gate kind, default value, variants when present, and cancellation
signal.

## Cache decisions and coalesce requests

### Cache provider decisions

Supply a cache store to the gate factory:

```typescript
import type { Decision } from "gated"

const cache = {
  get: (key: string) => redis.get<Decision>(key),
  set: (key: string, value: Decision) => redis.set(key, value),
  delete: (key: string) => redis.del(key),
}

const gate = buildGate({
  cache,
  identify,
  decide,
  onCacheError: (report) => reportCacheError(report),
})
```

The cache store controls serialization and expiry. Cache errors do not fail evaluation.
Gated discards an invalid cached decision and continues to the provider.

### Share concurrent provider work

Gated coalesces concurrent evaluations for the same evaluation key by default. These
evaluations share one provider call but keep separate hooks and cancellation paths.

Disable this behavior when the provider call must run once per evaluation:

```typescript
const gate = buildGate({
  coalesce: false,
  identify,
  decide,
})
```

Prefer an `after` hook for exposure tracking. The hook runs once for each evaluation,
even when evaluations share provider work.

### Customize the evaluation key

The default evaluation key includes the flag key, gate shape, and typed `distinctId`.
Provide `evaluationKey` when other identity fields affect the provider decision:

```typescript
const gate = buildGate({
  cache,
  identify,
  decide,
  evaluationKey: (context) =>
    JSON.stringify([context.flagKey, context.identity?.distinctId, context.identity?.plan]),
})
```

A custom function replaces the complete default key. Return the same key only when all
matching evaluators can use the same provider decision.

## React integration

The `gated/react` entry point supports React 19 and Suspense.

### Read a gate in a component

Pass an evaluator to `useGate`:

```tsx
import { Suspense } from "react"
import { useGate } from "gated/react"

function BetaPanel() {
  const enabled = useGate(betaAccess)
  return enabled ? <NewPanel /> : <CurrentPanel />
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <BetaPanel />
    </Suspense>
  )
}
```

A component that calls a Gated hook needs a Suspense boundary.

Use `useGateBatch` to evaluate several gates with one suspension:

```tsx
import { useGateBatch } from "gated/react"

function Page() {
  const [hasBetaAccess, selectedTheme] = useGateBatch([betaAccess, theme])
  return <Dashboard beta={hasBetaAccess} theme={selectedTheme} />
}
```

### Render a feature conditionally

`FeatureGate` can add its own Suspense boundary when you supply `loading`:

```tsx
import { FeatureGate } from "gated/react"

function App() {
  return (
    <FeatureGate gate={betaAccess} loading={<Loading />} fallback={<CurrentPanel />}>
      <NewPanel />
    </FeatureGate>
  )
}
```

Boolean gates match `true` by default. Variant gates require a `match` prop.

### Control the React gate cache

React evaluations use a bounded promise cache. The default cache keeps at most 100 settled
entries for each evaluator, batch tuple, or custom function. The limit applies to identities
in each bucket, not to the full cache.

Pending evaluations stay in the cache by default. Set `pendingTtlMs` to let the cache remove
old pending evaluations. Cache removal does not cancel the evaluation.

Create a cache when you need custom limits, prefetch operations, or explicit invalidation:

```typescript
import { createGateCache } from "gated/react"

const cache = createGateCache({
  maxEntries: 250,
  pendingTtlMs: 30_000,
  ttlMs: 60_000,
})

cache.prefetch(betaAccess, { identity: user })
cache.invalidate(betaAccess, user)
cache.clear()
```

Provider change notifications invalidate matching entries automatically when the gate
factory has a `subscribe` function.

Pass the cache and an identity to `GateProvider`:

```tsx
import { createGateCache, GateProvider } from "gated/react"

const cache = createGateCache({ maxEntries: 250, ttlMs: 60_000 })

function App() {
  return (
    <GateProvider cache={cache} identity={{ distinctId: user.id }}>
      <Routes />
    </GateProvider>
  )
}
```

Use `useGateCache()` to read the active cache. Its `invalidate`, `invalidateBatch`,
`prefetch`, and `prefetchBatch` methods use the provider identity when you omit an identity:

```tsx
import { useGateCache } from "gated/react"

function RefreshButton() {
  const cache = useGateCache()
  return <button onClick={() => cache.invalidate(betaAccess)}>Refresh</button>
}
```

A cache that you use directly cannot read a provider identity. Supply an explicit identity
to its gate operations.

Identity cache keys can contain strings, numbers, booleans, `null`, `undefined`, arrays,
and plain records with string keys. Other values cause a `TypeError`. This includes `Date`,
`Map`, symbols, functions, bigints, and circular references.

All exports from `gated/react` are client-only. The module has a `"use client"` directive.
For server rendering, mount `GateProvider` inside the client boundary and above the Suspense
boundaries that contain gate consumers. A bare provider creates an isolated cache for each
mount. A client-only application does not need `GateProvider`.

## Connect a provider

The provider adapter must return a boolean or variant decision.

### LaunchDarkly

```typescript
import * as LaunchDarkly from "launchdarkly-js-client-sdk"
import { buildGate, decision } from "gated"

const client = LaunchDarkly.initialize("client-id", { key: "user-key" })

const gate = buildGate({
  identify: () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => {
    const detail = await client.variationDetail(key, "control")
    return decision.variant(detail.value, detail)
  },
})
```

### PostHog

```typescript
import posthog from "posthog-js"
import { buildGate, decision } from "gated"

const gate = buildGate({
  identify: () => ({ distinctId: getCurrentUserId() }),
  decide: (key) => decision.boolean(posthog.isFeatureEnabled(key) ?? false),
})
```

### Custom HTTP API

```typescript
import { buildGate, decision } from "gated"

const gate = buildGate({
  identify: () => ({ distinctId: user.id }),
  decide: async (key, identity, { signal } = {}) => {
    const response = await fetch(`/api/features/${key}`, {
      method: "POST",
      body: JSON.stringify(identity),
      signal,
    })

    const result = await response.json()
    return decision.boolean(result.enabled)
  },
})
```

## Test a gate

Override the identity in a test:

```typescript
const result = await betaAccess({
  identity: { distinctId: "test-user" },
})
```

Or create a gate factory with a test provider:

```typescript
const testGate = buildGate({
  identify: () => ({ distinctId: "test-user" }),
  decide: (key) => decision.boolean(key === "beta-access"),
})
```

## Public entry points

| Entry point   | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `gated`       | Gate factories, decisions, hooks, types, and errors. |
| `gated/hooks` | Built-in hooks.                                      |
| `gated/react` | React hooks, components, and gate cache tools.       |

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## License

Gated uses the [MIT License](LICENSE).
