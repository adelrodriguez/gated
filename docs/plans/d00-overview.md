# Series D — overview

Source: the 2026-08-10 architecture review, revised on 2026-08-14 against main after #82–#90. The original review produced seven candidates as "Series C"; that name was later taken by the merged React API redesign (#85/#87), and several candidates landed through other work before these plans were filed. This series keeps only what remains open, renumbered as Series D.

## Already resolved — do not re-plan

Candidate numbers below refer to the 2026-08-10 review's ordering, not to the merged React "Series C" plan files (which `docs/plans/2026-08-13-svelte-adapter.md` references).

| Original candidate (2026-08-10 review)                                                       | Resolved by                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Factory-owned evaluation state (candidate 1)                                                 | #83/#84 — `ResolutionState` is created per factory in `buildGate`; same-config-object isolation is tested. The registry-unification remainder is PR #92, stacked on this branch.                                                     |
| The `onPrepared` batch protocol (candidate 2, in part)                                       | #83/#84 — `ExecutionOverrides` is now `{ identityResult, provider }`; "the provider closure was called" replaced the prepared/required callback.                                                                                     |
| Double evaluation-key derivation and the cache-vs-coalescing key rule (candidate 5, in part) | #84 — one `config.evaluationKey` projection, derived once in `resolveDecision`.                                                                                                                                                      |
| React invalidation writing a cache the render never reads (candidate 7)                      | #87 — `useGateCache` binds invalidation and prefetch to the provider's cache.                                                                                                                                                        |
| Config normalization — was plan d01 (candidate 3)                                            | This branch — `resolveConfig` normalizes the config union once into an internal `ResolvedConfig` with a total `resolveIdentity`/`decide`; `identity.ts` is absorbed and the resolved config carries the factory's `ResolutionState`. |

## Plans

| Plan | Title                                           | Status      | Depends on | Was (2026-08-10 review) |
| ---- | ----------------------------------------------- | ----------- | ---------- | ----------------------- |
| d02  | Finish the decision-source seam                 | ready       | d01 (done) | candidate 2 (remainder) |
| d03  | One broadcaster for provider change signals     | exploration | —          | candidate 4             |
| d04  | Dissolve `shared.ts` into a gate-shape module   | exploration | d01 (done) | candidate 5 (remainder) |
| d05  | One hook-phase runner, detached by construction | exploration | —          | candidate 6             |

**ready** — design settled enough to hand off; open decisions are listed and small.
**exploration** — the friction is confirmed, but the design direction needs a decision before implementation; each plan lists the questions that must close first.

## Recommended order

d02 next. d03–d05 are independent of each other and of d02, and touch disjoint files.

## Shared context

- The engine still disables its own timeout when `execution` is present — an invariant the `ExecutionOverrides` interface does not state (d02).
- The consumer's `config.subscribe` is attached by two independent implementations with different lifetimes (d03).
- `shared.ts` is named for its dependency graph, and `GateOptions` validation lives 60 lines away in `factory.ts` (d04).
- `hook.ts` exports four identical functions, and the detached-hooks invariant is re-asserted at four engine call sites (d05).
