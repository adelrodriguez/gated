# Gated Context

Gated is a provider-agnostic, type-safe feature-flag library for TypeScript applications. Package consumers supply identity resolution and provider decision logic; Gated executes the evaluation lifecycle, hooks, validation, and fallback behavior.

`buildGate` creates gate factories. Each evaluator resolves an identity (strictly by default or anonymously when opted in), runs the complete hook lifecycle, obtains and validates a discriminated provider decision when needed, and returns a boolean or configured variant. Evaluators also expose `details()` for provenance, payload, and fallback errors; call options support identity overrides and cancellation. Factory and per-gate timeouts return the configured default.

Factories can evaluate several of their own gates through `snapshot()`. A snapshot resolves identity once, preserves per-gate lifecycle and fallback semantics, and uses optional provider-level `decideMany` batching. The cache and dedupe recipes compose in either order.

React support is an optional integration at `gated/react`. It uses React 19's `use()` API. Components that call a `createReactGate` hook directly need a Suspense boundary; `FeatureGate` supplies its own. React evaluation promises are cached by stable identity keys with bounded TTL/LRU storage and explicit invalidation.

Use the vocabulary in [docs/agents/domain.md](docs/agents/domain.md). The package's public entry points are `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react`.
