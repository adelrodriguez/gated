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
import { buildGate } from "gated";

// Create a gate factory with your provider's logic
const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key, identity) => {
    // Your provider's API call
    const enabled = await yourProvider.isEnabled(key, identity.distinctId);
    return { value: enabled };
  },
});

// Create type-safe feature flags
const betaAccess = gate({ key: "beta-access", defaultValue: false });
const newDashboard = gate({ key: "new-dashboard", defaultValue: false });

// Evaluate flags
const hasBetaAccess = await betaAccess(); // false
const hasNewDashboard = await newDashboard(); // true
```

## Usage

### Boolean Flags

Boolean flags represent true/false feature toggles:

```typescript
// Using the gate from Quick Start
const darkMode = gate({ key: "dark-mode", defaultValue: false });

if (await darkMode()) {
  enableDarkMode();
}
```

### Variant Flags

String variants for A/B tests or multi-option features:

```typescript
const themeFlag = gate({
  key: "theme",
  defaultValue: "light", // Type-safe based on the variants array
  variants: ["light", "dark", "system"],
});

const theme = await themeFlag(); // Type: "light" | "dark" | "system"
```

### Hook System

Intercept the flag evaluation lifecycle with hooks. Gated supports five lifecycle stages:

- **`before`** - Runs before flag evaluation
- **`resolve`** - Can short-circuit evaluation by returning a decision
- **`after`** - Runs after successful evaluation
- **`error`** - Runs when evaluation throws an error
- **`finally`** - Always runs after evaluation completes

```typescript
import { createHook } from "gated";

// Create a custom logging hook
const loggingHook = createHook(() => ({
  before: async (context) => {
    console.log(`Evaluating flag: ${context.flagKey}`);
  },
  after: async (context, decision) => {
    console.log(`Result for ${context.flagKey}:`, decision);
  },
  error: async (context, error) => {
    console.error(`Error evaluating ${context.flagKey}:`, error);
  },
}));

// Add hooks when building your gate
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [loggingHook()],
});
```

### Built-in Recipes

Two hook implementations are included:

#### Cache Hook

Caches flag decisions by identity:

```typescript
import { cacheHook } from "gated/hooks";

const cache = {
  get: async (key: string) => await redis.get(key),
  set: async (key: string, value: Decision) => await redis.set(key, value),
};

// Add to your gate's hooks array
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [cacheHook(cache)],
});
```

#### Dedupe Hook

Deduplicates concurrent requests for the same flag:

```typescript
import { dedupeHook } from "gated/hooks";

// Add to your gate's hooks array
const gate = buildGate({
  identify: async () => ({ distinctId: userId }),
  decide: async (key, identity) => provider.evaluate(key, identity),
  hooks: [dedupeHook()],
});

// Only one API call will be made even with concurrent evaluations
const [result1, result2] = await Promise.all([betaFlag(), betaFlag()]);
```

### React Integration

React is currently the only framework with dedicated integration. The core library works in any JavaScript environment.

#### React Hooks

Convert gate functions into React hooks using the `createReactHook()` function. Components using these hooks must be wrapped in a Suspense boundary:

```typescript
import { createReactHook } from "gated/react";

// Using the gate from Quick Start
const betaFlag = gate({ key: "beta-access", defaultValue: false });
export const useBetaAccess = createReactHook(betaFlag);

// Use in components (wrapped in Suspense)
function MyComponent() {
  const hasBeta = useBetaAccess();
  return hasBeta ? <BetaFeature /> : <OldFeature />;
}

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <MyComponent />
    </Suspense>
  );
}
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

For variant flags, use the `match` prop to specify the expected value (defaults to `true` for boolean flags).

## API Reference

### Core API

#### `buildGate<TIdentity>(config)`

Creates a gate factory function for evaluating feature flags.

```typescript
const gate = buildGate({
  identify: () => Promise<TIdentity>,
  decide: (key: string, identity: TIdentity) => Promise<Decision>,
  hooks?: Hook[]
})
```

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

#### `createReactHook(gateFn)`

Converts a gate function into a React hook using React 19's `use()` primitive. Components using the hook must be wrapped in a Suspense boundary.

#### `<FeatureGate>`

Conditionally renders children based on flag evaluation. Includes built-in Suspense boundary.

**Props:** `gate`, `loading?`, `fallback?`, `overrideIdentity?`, `match?`

## TypeScript Support

Gated provides full type inference for variant flags and supports custom identity types:

```typescript
// Custom identity types
interface UserIdentity extends Identity {
  distinctId: string;
  email: string;
  plan: "free" | "pro" | "enterprise";
}

const gate = buildGate<UserIdentity>({
  identify: async () => ({
    distinctId: user.id,
    email: user.email,
    plan: user.plan,
  }),
  decide: async (key, identity) => {
    // identity is fully typed as UserIdentity
    return provider.evaluate(key, identity);
  },
});
```

Variant flag return types are automatically inferred from the `variants` array (see Variant Flags section).

## Provider Integration

Gated works with any feature flag provider by implementing the `decide` function:

### LaunchDarkly

```typescript
import * as LaunchDarkly from "launchdarkly-js-client-sdk";

const ldClient = LaunchDarkly.initialize("client-id", { key: "user-key" });

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => ({ value: await ldClient.variation(key, false) }),
});
```

### PostHog

```typescript
import posthog from "posthog-js";

const gate = buildGate({
  identify: async () => ({ distinctId: getCurrentUserId() }),
  decide: async (key) => ({ value: posthog.isFeatureEnabled(key) }),
});
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
    });
    return { value: (await res.json()).enabled };
  },
});
```

## Testing

Override identities when testing:

```typescript
const betaFlag = gate({ key: "beta-access", defaultValue: false });

// Test with specific identity
const result = await betaFlag({ distinctId: "test-user-123" });

// Or use a test gate with mocked decide function
const testGate = buildGate({
  identify: async () => ({ distinctId: "test" }),
  decide: async (key) => ({ value: key === "beta-access" }),
});
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
