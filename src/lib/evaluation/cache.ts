import type {
  Decision,
  DecisionCache,
  DecisionCacheErrorReport,
  DecisionCacheOptions,
  HookContext,
  Identity,
} from "../types"
import { reportInBackground } from "../hook"
import { normalizeError } from "../utils"
import { validateDecision } from "./decision"
import { type AnyGatedConfig, type GateOptions, getEvaluationKey } from "./shared"

export type CacheState = {
  generationByFlag: Map<string, number>
  keysByFlag: Map<string, Map<string, Identity | null>>
  subscription: { attaching: boolean; detach?: () => void }
}

export function createCacheState(): CacheState {
  return { generationByFlag: new Map(), keysByFlag: new Map(), subscription: { attaching: false } }
}

export type CacheConsultation = {
  decision?: Decision
  generation: number
  key: string
  store: DecisionCache
}

function getCacheOptions<TIdentity extends Identity>(
  config: Pick<AnyGatedConfig<TIdentity>, "cache">
): DecisionCacheOptions<TIdentity> | undefined {
  const option = config.cache
  if (!option) {
    return undefined
  }
  if ("get" in option && "set" in option) {
    return { store: option }
  }
  return option
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

function getInvalidationGeneration(runtime: CacheState, flagKey: string): number {
  return runtime.generationByFlag.get(flagKey) ?? 0
}

function indexCacheKey<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  runtime: CacheState,
  context: HookContext<TIdentity>,
  store: DecisionCache,
  key: string
): void {
  if (!store.delete || !config.subscribe) {
    return
  }

  const { subscription } = runtime
  const keys = runtime.keysByFlag.get(context.flagKey) ?? new Map<string, Identity | null>()
  keys.set(key, context.identity)
  runtime.keysByFlag.set(context.flagKey, keys)
  if (subscription.detach || subscription.attaching) {
    return
  }

  subscription.attaching = true
  const detach = config.subscribe(({ keys: changedFlagKeys }) => {
    const flagKeys = changedFlagKeys ?? [...runtime.keysByFlag.keys()]
    for (const flagKey of flagKeys) {
      const cacheKeys = runtime.keysByFlag.get(flagKey)
      if (!cacheKeys) {
        continue
      }
      runtime.generationByFlag.set(flagKey, (runtime.generationByFlag.get(flagKey) ?? 0) + 1)
      runtime.keysByFlag.delete(flagKey)
      for (const [cacheKey, identity] of cacheKeys) {
        deleteCacheEntry(
          config,
          { flagKey, identity: identity as TIdentity | null },
          store,
          cacheKey
        )
      }
    }
    if (runtime.keysByFlag.size === 0 && !subscription.attaching) {
      subscription.detach?.()
      subscription.detach = undefined
    }
  })
  subscription.attaching = false
  if (runtime.keysByFlag.size === 0) {
    detach()
  } else {
    subscription.detach = detach
  }
}

export async function consultCache<TIdentity extends Identity, T extends string[]>(
  config: AnyGatedConfig<TIdentity>,
  runtime: CacheState,
  context: HookContext<TIdentity>,
  options: GateOptions<T>
): Promise<CacheConsultation | undefined> {
  const cacheOptions = getCacheOptions(config)
  if (!cacheOptions || !context.identity) {
    return undefined
  }

  let key: string
  try {
    const evaluationKey = getEvaluationKey(context, cacheOptions.key)
    if (evaluationKey === undefined) {
      return undefined
    }
    key = evaluationKey
  } catch (error) {
    reportCacheError(config, context, "key", context.flagKey, error)
    return undefined
  }
  indexCacheKey(config, runtime, context, cacheOptions.store, key)
  const generationBeforeRead = getInvalidationGeneration(runtime, context.flagKey)

  let cached: Decision | null | undefined
  try {
    cached = await cacheOptions.store.get(key)
  } catch (error) {
    reportCacheError(config, context, "get", key, error)
    return {
      generation: getInvalidationGeneration(runtime, context.flagKey),
      key,
      store: cacheOptions.store,
    }
  }
  const generation = getInvalidationGeneration(runtime, context.flagKey)
  if (generation !== generationBeforeRead) {
    return { generation, key, store: cacheOptions.store }
  }
  if (cached === null || cached === undefined) {
    return { generation, key, store: cacheOptions.store }
  }

  try {
    validateDecision(cached, options)
  } catch (error) {
    reportCacheError(config, context, "validate", key, error)
    deleteCacheEntry(config, context, cacheOptions.store, key)
    return { generation, key, store: cacheOptions.store }
  }
  return { decision: cached, generation, key, store: cacheOptions.store }
}

export function writeCacheDecision<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  runtime: CacheState,
  context: HookContext<TIdentity>,
  consultation: CacheConsultation,
  decision: Decision
): void {
  void Promise.resolve()
    .then(() => {
      if (getInvalidationGeneration(runtime, context.flagKey) !== consultation.generation) {
        return
      }
      return consultation.store.set(consultation.key, decision)
    })
    .catch((error: unknown) => {
      reportCacheError(config, context, "set", consultation.key, error)
      return null
    })
}
