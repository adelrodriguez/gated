# b07 — Per-evaluation hook state

Fixes: A2. Depends on: b01 (recipes' key handling), b04 (post-commit phase semantics). Additive; recipes migrate internally.

## Goal

Stateful hooks correlate lifecycle phases through an explicit, documented per-evaluation state bag instead of using the live `HookContext` object as a WeakMap key.

## Problem

The engine deliberately reuses one context object across phases so hooks can treat its reference as an ownership token (src/lib/index.ts:397-399). `cacheHook` keeps a `consulted` WeakSet of contexts; `dedupeHook` stores `owner: HookContext` and compares `existing.owner === context`. It works, but the contract is implicit — nothing in the public `Hook` docs says the context is reference-stable per evaluation, and a third-party hook author who clones or destructures the context breaks silently. The comment in the engine is the only guardrail.

## Design

Add a lazily created, evaluation-scoped map to the context:

```ts
type HookContext<TIdentity> = {
  // ...existing readonly fields
  readonly state: Map<unknown, unknown>
}
```

- One `Map` per evaluation, shared by all hooks and phases of that evaluation, created on first access (getter over a nullable slot in the `Evaluation` record) so zero-hook and stateless-hook evaluations allocate nothing.
- Keying discipline is the hook's job: recipes use a module-private `Symbol` as their namespace key, which the docs recommend for third-party hooks.
- Reference stability of the context itself remains guaranteed and becomes documented (it is now part of the public contract that `state` persists across phases), but hooks no longer need to exploit it.
- Migrate recipes: `cacheHook` stores `{ consulted: true, key }` under its symbol (also resolving b01's compute-key-once requirement without a context-keyed side table); `dedupeHook` stores its resolved key and an `isOwner` marker, replacing the `owner === context` comparison. External behavior identical.

## Changes

- `src/lib/types.ts` — `state` on `HookContextBase` with doc comment (scope, sharing, symbol-key recommendation).
- `src/lib/index.ts` — `state` getter on both context literals backed by a lazy slot on `Evaluation`; update the ownership comment to point at `state`.
- `src/hooks/recipes.ts` — migrate both recipes off WeakSet/owner-reference onto namespaced state.
- README — Hook System: document `context.state`, its lifetime, and the namespacing convention; note the context object is reference-stable per evaluation.

## Tests

- `src/__tests__/lifecycle.test.ts` — a hook writing in `before` reads the same value in `resolve`/`after`/`error`/`finally`; two hooks using distinct symbol keys do not observe each other; two concurrent evaluations of the same gate get distinct state maps; state is absent-by-default (no allocation observable — assert via a context snapshot that `state` is only materialized on access, e.g. spy on the getter path if practical, otherwise drop this assertion).
- `src/hooks/__tests__/recipes.test.ts` — existing recipe suites pass unchanged (behavioral parity); add a regression that a hook receiving a _cloned_ context (spread) still works for reads that only need `state` passed along — documents that cloning drops live getters and is unsupported.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor. "Hooks receive `context.state`, an evaluation-scoped map for correlating lifecycle phases. Built-in recipes now use it; the context object's per-evaluation reference stability is now a documented guarantee."
