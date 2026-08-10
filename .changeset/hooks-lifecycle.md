---
"gated": minor
---

BREAKING: Redesign hooks as pure observers.

- Hooks contain only `before`, `after`, `error`, and `finally` observers. Resolving hooks,
  hook context state, `createStateSlot`, `gated/hooks/recipes`, `cacheHook`, and
  `dedupeHook` are removed. Use the `cache` config for caching, `coalesce` for request
  coalescing, a closure `WeakMap` for cross-phase observer state, and a wrapper around
  `decide` for decision overrides.
- Replace `createHook` with `defineHook`, which accepts either a direct hook object or a
  typed options factory.
- Add `onHookError` to `GatedConfig` so hook failures in every lifecycle phase are reported
  instead of silently swallowed. Failures are normalized to `Error` before reaching `error`
  hooks or `onHookError`.
- `after` hooks run detached after a decision commits, so slow observers no longer add
  evaluation latency. There is no drain operation: short-lived and serverless runtimes must
  not use `after` or `finally` for durable work.
- `HookContext` exposes readonly gate metadata: a discriminated `kind`, `defaultValue`, and
  `variants` for variant gates. It accepts only the identity generic.
- Each evaluation uses a fixed hook-list snapshot.
- Export contextual `GatedError` subclasses for missing identities, decision mismatches,
  and invalid variants.
