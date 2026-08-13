import type {
  Decision,
  DecisionCache,
  DecisionCacheErrorReport,
  DecisionSource,
  HookContext,
  Identity,
  MaybePromise,
} from "../types"
import { reportInBackground } from "../hook"
import { normalizeError } from "../utils"
import { validateDecision } from "./decision"
import { type AnyGatedConfig, type GateOptions, getEvaluationKey } from "./shared"
import { raceWithSignal } from "./signals"

type PendingResolution = {
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
  generationByFlag: Map<string, number>
  keysByFlag: Map<string, Map<string, Identity | null>>
  pending: Map<string, PendingResolution>
  subscription: { attaching: boolean; detach?: () => void }
}

export function createResolutionState(): ResolutionState {
  return {
    generationByFlag: new Map(),
    keysByFlag: new Map(),
    pending: new Map(),
    subscription: { attaching: false },
  }
}

export type DecisionResolution = {
  decision: Decision
  source: DecisionSource
}

function reportCacheError<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  context: Pick<HookContext<TIdentity>, "flagKey" | "identity">,
  operation: DecisionCacheErrorReport["operation"],
  key: string,
  error: unknown
): void {
  reportInBackground(config.onCacheError, {
    error: normalizeError(error),
    flagKey: context.flagKey,
    identity: context.identity,
    key,
    operation,
  })
}

function deleteCacheEntry<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  context: Pick<HookContext<TIdentity>, "flagKey" | "identity">,
  store: DecisionCache,
  key: string
): void {
  if (!store.delete) {
    return
  }
  void Promise.resolve()
    .then(() => store.delete?.(key))
    .catch((error: unknown) => {
      reportCacheError(config, context, "delete", key, error)
      return null
    })
}

function generationOf(state: ResolutionState, flagKey: string): number {
  return state.generationByFlag.get(flagKey) ?? 0
}

function indexCacheKey<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  state: ResolutionState,
  context: HookContext<TIdentity>,
  store: DecisionCache,
  key: string
): void {
  if (!store.delete || !config.subscribe) {
    return
  }

  const { subscription } = state
  const keys = state.keysByFlag.get(context.flagKey) ?? new Map<string, Identity | null>()
  keys.set(key, context.identity)
  state.keysByFlag.set(context.flagKey, keys)
  if (subscription.detach || subscription.attaching) {
    return
  }

  subscription.attaching = true
  const detach = config.subscribe(({ keys: changedFlagKeys }) => {
    // An invalidated flag's in-flight provider call is stale too: already-attached followers
    // keep the leader's decision, but later evaluations must not join it.
    const changed = changedFlagKeys && new Set(changedFlagKeys)
    for (const [pendingKey, entry] of state.pending) {
      if (!changed || changed.has(entry.flagKey)) {
        state.pending.delete(pendingKey)
      }
    }
    const flagKeys = changedFlagKeys ?? [...state.keysByFlag.keys()]
    for (const flagKey of flagKeys) {
      const cacheKeys = state.keysByFlag.get(flagKey)
      if (!cacheKeys) {
        continue
      }
      state.generationByFlag.set(flagKey, (state.generationByFlag.get(flagKey) ?? 0) + 1)
      state.keysByFlag.delete(flagKey)
      for (const [cacheKey, identity] of cacheKeys) {
        deleteCacheEntry(
          config,
          { flagKey, identity: identity as TIdentity | null },
          store,
          cacheKey
        )
      }
    }
    if (state.keysByFlag.size === 0 && !subscription.attaching) {
      subscription.detach?.()
      subscription.detach = undefined
    }
  })
  subscription.attaching = false
  if (state.keysByFlag.size === 0) {
    detach()
  } else {
    subscription.detach = detach
  }
}

type StoreConsultation = {
  decision?: Decision
  generation: number
}

async function consultStore<TIdentity extends Identity, T extends string[]>(
  config: AnyGatedConfig<TIdentity>,
  state: ResolutionState,
  context: HookContext<TIdentity>,
  options: GateOptions<T>,
  store: DecisionCache,
  key: string
): Promise<StoreConsultation> {
  const generationBeforeRead = generationOf(state, context.flagKey)

  let cached: Decision | null | undefined
  try {
    cached = await store.get(key)
  } catch (error) {
    reportCacheError(config, context, "get", key, error)
    return { generation: generationOf(state, context.flagKey) }
  }
  const generation = generationOf(state, context.flagKey)
  if (generation !== generationBeforeRead || cached === null || cached === undefined) {
    return { generation }
  }

  try {
    validateDecision(cached, options)
  } catch (error) {
    reportCacheError(config, context, "validate", key, error)
    deleteCacheEntry(config, context, store, key)
    return { generation }
  }
  return { decision: cached, generation }
}

function writeThrough<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  state: ResolutionState,
  context: HookContext<TIdentity>,
  store: DecisionCache,
  generation: number,
  key: string,
  decision: Decision
): void {
  void Promise.resolve()
    .then(() => {
      if (generationOf(state, context.flagKey) !== generation) {
        return
      }
      return store.set(key, decision)
    })
    .catch((error: unknown) => {
      reportCacheError(config, context, "set", key, error)
      return null
    })
}

/**
 * Resolves one decision through the factory's memory: join an in-flight coalesced call, fall back
 * to the cache store, and otherwise lead the provider call — sharing the decision with followers
 * and writing it through to the store. Owns decision validation on every path; a decision that
 * leaves this function satisfies the evaluation's gate shape.
 */
export async function resolveDecision<TIdentity extends Identity, T extends string[]>(
  config: AnyGatedConfig<TIdentity>,
  state: ResolutionState,
  context: HookContext<TIdentity>,
  options: GateOptions<T>,
  provider: () => MaybePromise<Decision>,
  signal: AbortSignal
): Promise<DecisionResolution> {
  const store = config.cache
  const coalesce = config.coalesce === true

  let key: string | undefined
  try {
    key = getEvaluationKey(context, config.evaluationKey)
  } catch (error) {
    reportCacheError(config, context, "key", context.flagKey, error)
    key = undefined
  }

  if (key === undefined || (!store && !coalesce)) {
    const decision = await raceWithSignal(provider, signal)
    validateDecision(decision, options)
    return { decision, source: "provider" }
  }

  let write: { generation: number; store: DecisionCache } | undefined
  if (store) {
    indexCacheKey(config, state, context, store, key)
    const consultation = await raceWithSignal(
      () => consultStore(config, state, context, options, store, key),
      signal
    )
    if (consultation.decision) {
      return { decision: consultation.decision, source: "cache" }
    }
    write = { generation: consultation.generation, store }
  }

  // The in-flight check and leadership registration must stay in one synchronous block: an await
  // between them lets two concurrent evaluations both miss the pending map and both lead.
  let lead: PendingResolution | undefined
  if (coalesce) {
    const existing = state.pending.get(key)
    if (existing) {
      const decision = await raceWithSignal(() => existing.promise, signal)
      validateDecision(decision, options)
      return { decision, source: "provider" }
    }
    const request = Promise.withResolvers<Decision>()
    lead = {
      flagKey: context.flagKey,
      promise: request.promise,
      reject: request.reject,
      resolve: request.resolve,
    }
    void lead.promise.catch(() => null)
    state.pending.set(key, lead)
  }

  try {
    const decision = await raceWithSignal(provider, signal)
    lead?.resolve(decision)
    validateDecision(decision, options)
    if (write) {
      writeThrough(config, state, context, write.store, write.generation, key, decision)
    }
    return { decision, source: "provider" }
  } catch (error) {
    const resolutionError = normalizeError(error)
    lead?.reject(resolutionError)
    throw resolutionError
  } finally {
    if (lead && state.pending.get(key) === lead) {
      state.pending.delete(key)
    }
  }
}
