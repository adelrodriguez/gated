# d01 — Normalize the config once (`ResolvedConfig`)

Status: ready. From the 2026-08-10 architecture review (revised 2026-08-14). Depends on: —. Unlocks: d02. Behavioral change: none; the strict/anonymous/caller-identity semantics are pinned by existing tests.

## Goal

`buildGate` resolves the config union once into an internal `ResolvedConfig` with a total identity resolver and a total decide. No internal module sees `AnyGatedConfig` or re-branches on `anonymous === "allow"`.

## Problem

- `buildGate`'s three overloads resolve strict vs anonymous vs caller-identity **at the type level**, then erase the answer into the `AnyGatedConfig` union (src/lib/evaluation/shared.ts:9-12). Downstream, `config.anonymous === "allow"` is re-tested at four sites: engine.ts:133, identity.ts:41, identity.ts:59, batch.ts:61.
- `evaluateConfiguredDecision` (identity.ts:35-48) and `evaluateConfiguredMany` (identity.ts:50-66) are structurally the same eight lines twice — both exist only to re-apply the anonymous rule before calling `decide`/`decideMany`.
- `CallerIdentityGatedConfig` has `identify?: never`, so `identify` (identity.ts:18-20) must handle "no identify function" — a case reachable for only one of the three config shapes, handled in the path all three share.
- The whole config object is threaded through engine, batch, and resolve; each callee re-reads the union's optional fields.

## Design

```ts
// src/lib/evaluation/resolved-config.ts (new)
export type ResolvedConfig<TIdentity extends Identity> = {
  // Total: the anonymous/strict/caller-identity rules are baked in at construction.
  resolveIdentity(override: TIdentity | null | undefined): Promise<TIdentity | null>
  decide(
    key: string,
    identity: TIdentity | null,
    options: { signal: AbortSignal }
  ): Promise<Decision>
  decideMany?: (
    keys: readonly string[],
    identity: TIdentity | null,
    options: { signal: AbortSignal }
  ) => Promise<Record<string, Decision>>
  cache?: DecisionCache
  coalesce: boolean
  evaluationKey?: (context: HookContext<TIdentity>) => string
  hooks: Array<Hook<TIdentity>>
  timeoutMs?: number
  onHookError?: GatedConfig<TIdentity>["onHookError"]
  onCacheError?: GatedConfig<TIdentity>["onCacheError"]
  subscribe?: GatedConfig<TIdentity>["subscribe"]
}

export function resolveConfig<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>
): ResolvedConfig<TIdentity>
```

- `resolveIdentity` closes over `config.identify` and the anonymous rule; `identify`'s three-way branching (identity.ts:5-33) moves inside the resolver and `IdentityNotFoundError` throwing happens in exactly one place.
- `decide`/`decideMany` close over the anonymous null-identity guard; `evaluateConfiguredDecision`/`evaluateConfiguredMany` are deleted. The "no `decideMany` configured → `{}`" behavior (identity.ts:56-58) moves to the batch flush, its only caller with an opinion.
- `coalesce` resolves `config.coalesce !== false` (resolve.ts:243) once.
- `AnyGatedConfig` survives only in `buildGate`'s implementation signature and `resolveConfig`'s parameter. Every other internal signature takes `ResolvedConfig`.
- `hooks` is copied at resolution (`[...(config.hooks ?? [])]`, currently done per evaluation at engine.ts:105) — one copy per factory, not per call. This narrows post-construction mutation of `config.hooks`; document as intended.

## Changes

- `src/lib/evaluation/resolved-config.ts` — new: `ResolvedConfig`, `resolveConfig`.
- `src/factory.ts` — call `resolveConfig(config)` once in `buildGate`; pass the resolved config everywhere `config` currently flows.
- `src/lib/evaluation/engine.ts` — take `ResolvedConfig`; the identity branch at :126-134 becomes `resolved.resolveIdentity(callOptions?.identity)` behind the `identityResult` check (which d02 then removes).
- `src/lib/evaluation/batch.ts` — take `ResolvedConfig`; identity via `resolveIdentity`; flush via `resolved.decideMany` with the `{}` fallback inline.
- `src/lib/evaluation/resolve.ts` — take `ResolvedConfig`; read `resolved.coalesce` and `resolved.cache` directly.
- `src/lib/evaluation/identity.ts` — deleted (contents absorbed by `resolveConfig`).

## Tests

- Existing suites pin the semantics: core.test.ts (strict identity errors), lifecycle.test.ts (anonymous flows, caller identity), batch.test.ts (batch identity + `decideMany` fallback). All must pass unchanged.
- New `src/lib/evaluation/__tests__/resolved-config.test.ts`: the three config shapes × (override present / null / absent) × (identify returns value / null / throws) — the whole matrix in one place, against `resolveIdentity`/`decide` directly. Migrate the `identify` cases out of engine.test.ts (which currently tests identity past the engine's interface) and slim engine.test.ts to engine behavior.
- Regression: `config.hooks` mutated after `buildGate` no longer affects evaluations — assert the copy semantics explicitly so the behavior change is a decision, not an accident.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: none (internal), unless the `hooks` copy-at-build semantics is deemed consumer-visible — then patch, with a note.

## Open decisions for the implementer

- Whether `ResolvedConfig` also carries the `ResolutionState` from #84 as a field, so one value threads through the evaluation path instead of two. Recommended.
