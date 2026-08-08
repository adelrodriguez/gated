# Gated Context

Gated is a provider-agnostic, type-safe feature-flag library for TypeScript applications. Package consumers supply identity resolution and provider decision logic; Gated executes the evaluation lifecycle, hooks, validation, and fallback behavior.

`buildGate` creates gates. A gate resolves an identity, gives hooks a chance to observe or resolve the request, obtains a provider decision when needed, and returns a boolean or configured variant. Failures fall back to the gate's default value.

React support is an optional integration at `gated/react`. It uses React 19's `use()` API, and consumers of `createReactGate` must provide a Suspense boundary.

Use the vocabulary in [docs/agents/domain.md](docs/agents/domain.md). The package's public entry points are `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react`.
