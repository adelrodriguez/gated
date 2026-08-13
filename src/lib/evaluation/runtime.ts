import { type CacheState, createCacheState } from "./cache"
import { type CoalescingState, createCoalescingState } from "./coalesce"

/**
 * Mutable evaluation state owned by a single `buildGate` factory: in-flight coalesced provider
 * calls and cache invalidation bookkeeping. Created once per factory so gates from different
 * factories never share state, even when built from the same config object.
 */
export type EvaluationRuntime = {
  cache: CacheState
  coalescing: CoalescingState
}

export function createEvaluationRuntime(): EvaluationRuntime {
  return { cache: createCacheState(), coalescing: createCoalescingState() }
}
