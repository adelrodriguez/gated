# Gated Context

Gated is a provider-agnostic, type-safe feature-flag library for TypeScript applications. Package consumers supply identity resolution and provider decision logic; Gated executes the evaluation lifecycle, hooks, validation, and fallback behavior.

`buildGate` creates gate factories. Each evaluator resolves an identity (strictly by default or anonymously when opted in), runs the complete hook lifecycle, obtains and validates a discriminated provider decision when needed, and returns a boolean or configured variant. Evaluators also expose `details()` for provenance, payload, and fallback errors; call options support identity overrides and cancellation. Factory and per-gate timeouts return the configured default.

Factories can evaluate several of their own gates through `batch()`. A batch resolves identity once, preserves per-gate lifecycle and fallback semantics, and uses optional provider-level `decideMany` batching. Cache and request coalescing are built-in behaviors. Hooks are observers.

React support is an optional integration at `gated/react`. Components pass evaluators to `useGate`, `useGateBatch`, and `FeatureGate`. Batch results are synchronously readable and destructurable in flag order. React evaluation promises use a bounded gate cache with live invalidation and prefetch support. `GateProvider` isolates the cache for server rendering and supplies a default identity. Components that call a gate hook need a Suspense boundary; `FeatureGate` supplies one when `loading` is present.

Use the vocabulary in [docs/agents/domain.md](docs/agents/domain.md). The package's public entry points are `gated`, `gated/hooks`, and `gated/react`.
