# b03 — React cache-key safety and invalidation ergonomics

Fixes: F4, F11. Depends on: —. Breaking: identities/cache keys containing non-plain objects, symbols, or functions now throw instead of silently colliding; custom-gate `invalidate` gains a key-based form.

## Goal

A React gate cache key is either provably distinct for distinct inputs or the call throws loudly. Invalidating a custom gate does not require fabricating operational arguments.

## Problem

- **F4.** `stableSerialize` (src/integrations/react.tsx:196) walks only own enumerable keys. Every `Date` serializes to `object:{}` — as do `Map`, `Set`, `URL`, and class instances — so two identities differing only by such a value share one cache entry: wrong flag value for the second identity, no error. Symbols collapse by description, functions by name. `IdentityValue` permits objects and symbols, so the type system invites exactly this; the docs' "JSON-serializable flat records" rule is unenforced and the serializer's `TypeError` branch is effectively unreachable. Separately, the `references` map is a _seen_-set (populated on first encounter, never unregistered), so a subobject referenced twice in sibling positions encodes as `reference:N` — `{ a: o, b: o }` and a structurally identical `{ a: {…}, b: {…} }` serialize differently. That is a spurious cache miss rather than a wrong value, but it breaks the equality-iff-structural-equality property the rewrite needs.
- **F11.** `invalidate(...args: TArgs)` requires the full argument tuple, so callers pass dummies for operational args the projection ignores: `useAccountGate.invalidate("account-1", "ignored-for-cache-key")`.

## Design

1. Align the serializer with the already-documented `ReactGateCacheKey` contract (scalars, arrays, string-keyed plain records): `stableSerialize` throws `TypeError` for symbols, functions, bigints, and any object whose prototype is not `Object.prototype`/`null` and is not an array. The error message names the offending path (e.g. `identity.createdAt`) so the failure is diagnosable from a component stack. Circular references also throw (currently encoded as `reference:` markers — a cycle cannot be a valid `ReactGateCacheKey`, and removing the marker simplifies the serializer). Cycle detection must be **ancestor-scoped**, not seen-scoped: track the active path in a `Set` added before recursing and deleted on the way out, so only genuine cycles throw and a shared sibling subobject serializes identically to two structurally equal distinct objects.
2. Identity keys flow through the same contract: a `Date` in an identity now throws at render instead of colliding. This matches `Identity`'s documented use; consumers who need richer values must project them (`cacheKey`) or stringify them in `identify`.

   This is a deliberate exception to the library's otherwise fail-soft posture, and it is worth stating why. `Identity` is `Record<string, IdentityValue>` and `IdentityValue` admits `object` and `symbol` (src/lib/types.ts:4-11), so a `Date` attribute is type-legal at the core layer and evaluates correctly there — React becomes the only layer that rejects it, at render time. The alternative (keep collapsing silently) is a wrong flag value for a real user, which no observability hook can surface; a `TypeError` naming `identity.createdAt` is diagnosable from a component stack. Identity-based `ReactGate`s also have no `cacheKey` escape hatch — that option exists only on the custom overload (src/integrations/react.tsx:46) — so the only remedy is changing `identify`, and the error message must say so explicitly.

3. `invalidate` accepts either the original argument tuple (unchanged, for gated evaluators) or, for custom gates, a projected key via a new `invalidateKey` companion:

```ts
useAccountGate.invalidateKey("account-1") // the value cacheKey would have produced
```

Keeping the tuple form avoids breaking existing call sites; `invalidateKey(key: ReactGateCacheKey)` bypasses the projection and serializes directly. Gated-evaluator hooks (identity-based) do not expose `invalidateKey` — identity is already the semantic key.

## Changes

- `src/integrations/react.tsx` — rewrite `stableSerialize` per the contract (path-tracking for error messages, cycle detection that throws, no bigint/symbol/function/reference encodings); add `invalidateKey` to `CustomReactGate` and wire it through `keyOf`'s namespace + serializer.
- README — React Integration: state that cache-key inputs are validated at render and what throws; replace the `invalidate("account-1", "ignored-for-cache-key")` example with `invalidateKey("account-1")`; keep a note that the tuple form remains for symmetry.

## Tests

Extend `src/__tests__/react.test.tsx`:

- Regression: two identities differing only by a `Date` value throw (previously: silent shared entry). Same for `Map`, class instance, symbol, function, bigint values, at top level and nested.
- Error message includes the offending path.
- Circular cache-key object throws; a shared but acyclic subobject does not.
- Distinctness properties (table-driven, property-style): for a corpus of structurally distinct valid keys — `0` vs `-0` vs `"0"`, `null` vs `undefined` vs `"null"`, `{a: undefined}` vs `{}`, `["a"]` vs `"a"`, nested records with reordered keys (equal) vs different values (distinct), `const o = { x: 1 }; { a: o, b: o }` vs `{ a: { x: 1 }, b: { x: 1 } }` (equal) — assert serialized equality iff structural equality.
- `invalidateKey("account-1")` evicts the entry created by `useAccountGate("account-1", "trace-1")`; tuple `invalidate` still works.

## Verification

- `bun test`, `bun run build`, `bun run check`

## Release

- Changeset: minor (breaking pre-1.0). "React gate cache keys are validated: non-plain objects, symbols, functions, and cycles now throw a `TypeError` naming the offending path instead of silently colliding. Custom React gates gain `invalidateKey()` so invalidation does not require operational arguments."
