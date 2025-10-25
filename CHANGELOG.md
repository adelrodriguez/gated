# gated

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
