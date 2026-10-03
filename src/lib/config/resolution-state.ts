import type { Decision, Identity } from "#lib/types"

export type PendingResolution = {
  flagKey: string
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

/**
 * Decision memory for one gate factory: in-flight coalesced provider calls plus cache invalidation
 * bookkeeping. Created once per factory so gates from different factories never share state, even
 * when built from the same config object.
 */
export type ResolutionState = {
  keysByFlag: Map<string, Map<string, Identity | null>>
  pending: Map<string, PendingResolution>
  // The invalidation subscription lives for the factory's lifetime, so the provider's detach
  // function is intentionally not retained.
  subscription: { attached: boolean; attaching: boolean }
  // One factory-wide counter: any flag-change notification invalidates every open write ticket.
  // A pending write lives for milliseconds and the next evaluation re-establishes it, so dropping
  // one is always safe — cheaper than tracking which flags a notification covers.
  writes: { generation: number }
}

export function createResolutionState(): ResolutionState {
  return {
    keysByFlag: new Map(),
    pending: new Map(),
    subscription: { attached: false, attaching: false },
    writes: { generation: 0 },
  }
}
