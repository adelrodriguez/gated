import type { PendingResolution } from "#lib/config/resolution-state"
import type { ResolvedConfig } from "#lib/config/resolved-config"
import type {
  Decision,
  DecisionCache,
  DecisionCacheErrorReport,
  DecisionSource,
  HookContext,
  Identity,
  GateOptions,
  MaybePromise,
} from "#lib/types"
import { validateDecision } from "#lib/gate/decision"
import { getEvaluationKey } from "#lib/gate/evaluation-key"
import { reportInBackground } from "#lib/shared/report"
import { raceWithSignal } from "#lib/shared/signals"
import { normalizeError } from "#lib/shared/utils"

export type DecisionResolution = {
  decision: Decision
  source: DecisionSource
}

function reportCacheError<TIdentity extends Identity>(
  config: ResolvedConfig<TIdentity>,
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
  config: ResolvedConfig<TIdentity>,
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

function indexCacheKey<TIdentity extends Identity>(
  config: ResolvedConfig<TIdentity>,
  context: HookContext<TIdentity>,
  store: DecisionCache,
  key: string
): void {
  if (!store.delete || !config.subscribe) {
    return
  }

  const { state } = config
  const keys = state.keysByFlag.get(context.flagKey) ?? new Map<string, Identity | null>()
  keys.set(key, context.identity)
  state.keysByFlag.set(context.flagKey, keys)
}

/**
 * Attaches the flag-change subscription that invalidates this factory's decision memory: it drops
 * in-flight coalesced calls and deletes indexed store entries for the changed flags, and
 * invalidates every pending cache write regardless of which flags changed. Attached on the first
 * evaluation that touches cache or coalescing and kept for the factory's lifetime. A throwing
 * `subscribe` never fails the evaluation: it is reported through `onCacheError` and the evaluation
 * continues without invalidation.
 */
function attachInvalidationSubscription<TIdentity extends Identity>(
  config: ResolvedConfig<TIdentity>,
  context: HookContext<TIdentity>,
  key: string
): void {
  const { state, subscribe } = config
  if (!subscribe) {
    return
  }
  const { subscription } = state
  if (subscription.attached || subscription.attaching) {
    return
  }

  subscription.attaching = true
  try {
    subscribe(({ keys: changedFlagKeys }) => {
      // An invalidated flag's in-flight provider call is stale too: already-attached followers
      // keep the leader's decision, but later evaluations must not join it.
      const changed = changedFlagKeys && new Set(changedFlagKeys)
      for (const [pendingKey, entry] of state.pending) {
        if (!changed || changed.has(entry.flagKey)) {
          state.pending.delete(pendingKey)
        }
      }
      // Invalidate open write tickets independently of the key index, which only fills when the
      // store can delete: a decision fetched before the change must never be written after it.
      const { writes } = state
      writes.generation += 1
      const store = config.cache
      const flagKeys = changedFlagKeys ?? [...state.keysByFlag.keys()]
      for (const flagKey of flagKeys) {
        const cacheKeys = state.keysByFlag.get(flagKey)
        if (!cacheKeys) {
          continue
        }
        state.keysByFlag.delete(flagKey)
        if (!store) {
          continue
        }
        for (const [cacheKey, identity] of cacheKeys) {
          deleteCacheEntry(
            config,
            { flagKey, identity: identity as TIdentity | null },
            store,
            cacheKey
          )
        }
      }
    })
    subscription.attached = true
  } catch (error) {
    reportCacheError(config, context, "subscribe", key, error)
  } finally {
    subscription.attaching = false
  }
}

type StoreConsultation = {
  decision?: Decision
  generation: number
}

async function consultStore<TIdentity extends Identity, T extends string[]>(
  config: ResolvedConfig<TIdentity>,
  context: HookContext<TIdentity>,
  options: GateOptions<T>,
  store: DecisionCache,
  key: string
): Promise<StoreConsultation> {
  const { state } = config
  const generationBeforeRead = state.writes.generation

  let cached: Decision | null | undefined
  try {
    cached = await store.get(key)
  } catch (error) {
    reportCacheError(config, context, "get", key, error)
    return { generation: state.writes.generation }
  }
  const generation = state.writes.generation
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
  config: ResolvedConfig<TIdentity>,
  context: HookContext<TIdentity>,
  store: DecisionCache,
  generation: number,
  key: string,
  decision: Decision
): void {
  void Promise.resolve()
    .then(() => {
      if (config.state.writes.generation !== generation) {
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
  config: ResolvedConfig<TIdentity>,
  context: HookContext<TIdentity>,
  options: GateOptions<T>,
  provider: () => MaybePromise<Decision>,
  signal: AbortSignal
): Promise<DecisionResolution> {
  const { coalesce, state } = config
  const store = config.cache

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
    indexCacheKey(config, context, store, key)
    attachInvalidationSubscription(config, context, key)
    const consultation = await raceWithSignal(
      () => consultStore(config, context, options, store, key),
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
    // Attach before registering leadership: nothing may throw between the pending registration
    // and the provider try/finally, or the entry orphans and later evaluations join it forever.
    attachInvalidationSubscription(config, context, key)
    state.pending.set(key, lead)
  }

  try {
    const decision = await raceWithSignal(provider, signal)
    lead?.resolve(decision)
    validateDecision(decision, options)
    if (write) {
      writeThrough(config, context, write.store, write.generation, key, decision)
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
