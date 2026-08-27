# Gated Context

Gated is a provider-independent, type-safe feature-flag library for TypeScript applications. Package consumers supply identity resolution and provider decision logic. Gated executes the evaluation lifecycle, hooks, validation, and fallback behavior.

`buildGate` creates gate factories. Each evaluator resolves an identity, runs the complete hook lifecycle, obtains and validates a discriminated provider decision when needed, and returns a boolean or a configured variant. Identity resolution is strict by default and anonymous when the factory opts in. Evaluators expose `details()` for the decision source, payload, and fallback error. Call options support identity overrides and cancellation. Factory and per-gate timeouts return the configured default.

Factories can evaluate several of their own gates through `batch()`. A batch resolves the identity once, preserves per-gate lifecycle and fallback semantics, and uses the provider-level `decideMany` function when present. Cache and request coalescing are built-in behaviors. Hooks are observers.

React support is an optional integration at `gated/react`. Components pass evaluators to `useGate`, `useGateBatch`, and `FeatureGate`. Batch results are synchronously readable and destructurable in flag order. React evaluation promises use a bounded gate cache with live invalidation and prefetch support. `GateProvider` isolates the cache for server rendering and supplies a default identity. Components that call a gate hook need a Suspense boundary. `FeatureGate` supplies one when `loading` is present.

Use the vocabulary in [docs/agents/domain.md](docs/agents/domain.md). The package's public entry points are `gated`, `gated/hooks`, and `gated/react`.
