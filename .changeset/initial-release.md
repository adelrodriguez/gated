---
"gated": minor
---

Initial release of Gated - a type-safe feature flag library for JavaScript and React applications

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
