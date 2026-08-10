// Recipes for common and useful hooks
import type { Decision, GateChanges, Hook, HookContext, IdentityValue } from "../lib/types"
import { getDefaultEvaluationKey } from "../lib/evaluation-key"
import { reportInBackground } from "../lib/hook-runner"
import { DedupeOwnerFinalizationError, HookResolutionAbortError } from "../lib/internal"

/**
 * Cache implementations own serialization. A variant payload may contain provider metadata that is
 * not JSON-safe, so persisted caches must either preserve it faithfully or normalize it.
 */
export interface Cache {
  get: (key: string) => Promise<Decision | null | undefined>
  set: (key: string, value: Decision) => Promise<void>
}

export type RecipeKeyFn = (context: HookContext) => string

export interface RecipeKeyOptions {
  key?: RecipeKeyFn
}

type CacheChangesOptions = RecipeKeyOptions & {
  changes: GateChanges
}

type EvictableCache = Cache & {
  delete(key: string): Promise<boolean | undefined>
}

interface PendingRequest {
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

function createPendingRequest(): PendingRequest {
  const { promise, reject, resolve } = Promise.withResolvers<Decision>()
  void promise.catch(() => null)

  return {
    promise,
    reject(error) {
      reject(new HookResolutionAbortError(error))
    },
    resolve,
  }
}

function getRecipeKey(context: HookContext, projection?: RecipeKeyFn): string {
  if (projection) {
    return projection(context)
  }

  if (!context.identity) {
    throw new Error("Cannot create a recipe key without an identity")
  }

  return getDefaultEvaluationKey(context.flagKey, context.identity.distinctId)
}

function isLegacyDecision(cached: IdentityValue): boolean {
  return (
    typeof cached === "object" &&
    cached !== null &&
    !Object.hasOwn(cached, "type") &&
    (Object.hasOwn(cached, "value") || Object.hasOwn(cached, "variant"))
  )
}

function getCachedDecisionError(context: HookContext, cached: IdentityValue): Error | undefined {
  if (typeof cached !== "object" || cached === null) {
    return new Error("Cached decision is invalid")
  }

  const type = Reflect.get(cached, "type")
  const decisionKind = type === "variant" ? "variant" : type === "boolean" ? "boolean" : undefined

  if (decisionKind === undefined) {
    return new Error("Cached decision is missing a valid type discriminant")
  }

  if (context.kind !== decisionKind) {
    return new Error(
      `Cached decision type mismatch: expected ${context.kind} decision but received ${decisionKind}`
    )
  }

  if (decisionKind === "boolean" && typeof Reflect.get(cached, "value") !== "boolean") {
    return new Error("Cached boolean decision contains an invalid value")
  }

  if (decisionKind === "variant") {
    const variant = Reflect.get(cached, "variant")
    if (typeof variant !== "string") {
      return new Error("Cached variant decision contains an invalid variant")
    }
    if (context.kind === "variant" && !context.variants.includes(variant)) {
      return new Error(`Cached decision contains invalid variant: ${variant}`)
    }
  }

  return undefined
}

export function cacheHook(cache: EvictableCache, options: CacheChangesOptions): Hook
export function cacheHook(cache: Cache, options?: RecipeKeyOptions): Hook
export function cacheHook(
  cache: Cache & { delete?: EvictableCache["delete"] },
  options?: RecipeKeyOptions & { changes?: GateChanges }
): Hook {
  const stateKey = Symbol("cache recipe state")
  const changes = options?.changes
  const cacheKeysByFlag = changes ? new Map<string, Set<string>>() : undefined
  if (changes && cacheKeysByFlag) {
    if (!cache.delete) {
      throw new TypeError("cacheHook requires cache.delete when changes is provided")
    }
    changes.subscribe((changedFlagKeys) => {
      const flagKeys = changedFlagKeys ?? [...cacheKeysByFlag.keys()]
      for (const flagKey of flagKeys) {
        const cacheKeys = cacheKeysByFlag.get(flagKey)
        if (!cacheKeys) {
          continue
        }
        cacheKeysByFlag.delete(flagKey)
        for (const cacheKey of cacheKeys) {
          reportInBackground(async (key: string) => {
            await cache.delete?.(key)
          }, cacheKey)
        }
      }
    })
  }
  const hook: Hook = {
    async resolve(context) {
      if (!context.identity) {
        return
      }

      const cacheKey = getRecipeKey(context, options?.key)
      if (cacheKeysByFlag) {
        const indexedKeys = cacheKeysByFlag.get(context.flagKey) ?? new Set<string>()
        indexedKeys.add(cacheKey)
        cacheKeysByFlag.set(context.flagKey, indexedKeys)
      }
      context.state.set(stateKey, { consulted: true, key: cacheKey })
      const cachedDecision = await cache.get(cacheKey)
      if (!cachedDecision) {
        return
      }

      if (isLegacyDecision(cachedDecision)) {
        return
      }

      const cachedDecisionError = getCachedDecisionError(context, cachedDecision)
      if (cachedDecisionError) {
        throw cachedDecisionError
      }

      return cachedDecision
    },

    async after(context, decision, meta) {
      const state = context.state.get(stateKey) as { consulted: true; key: string } | undefined
      context.state.delete(stateKey)

      if (
        !context.identity ||
        !state?.consulted ||
        (meta.source === "hook" && meta.resolver === hook)
      ) {
        return
      }

      await cache.set(state.key, decision)
    },

    finally(context) {
      context.state.delete(stateKey)
    },
  }

  return hook
}

/**
 * @deprecated Use `buildGate({ coalesce: true })` or its custom `key` option. This recipe remains
 * available for one major-version overlap window.
 */
export function dedupeHook(options?: RecipeKeyOptions): Hook {
  const pending = new Map<string, PendingRequest>()
  const stateKey = Symbol("dedupe recipe state")

  return {
    async resolve(context) {
      if (!context.identity) {
        return
      }

      const key = getRecipeKey(context, options?.key)
      const existing = pending.get(key)
      const result = existing?.promise
      context.state.set(stateKey, { isOwner: !existing, key })

      if (result) {
        // Wait for the in-flight request to complete
        return await result
      }

      pending.set(key, createPendingRequest())

      // Return undefined to let the normal flow continue
      return result
    },

    after(context, decision) {
      const state = context.state.get(stateKey) as { isOwner: boolean; key: string } | undefined
      context.state.delete(stateKey)
      if (!context.identity || !state?.isOwner) {
        return
      }

      const existing = pending.get(state.key)

      if (existing) {
        existing.resolve(decision)
        pending.delete(state.key)
      }
    },

    error(context, error) {
      const state = context.state.get(stateKey) as { isOwner: boolean; key: string } | undefined
      context.state.delete(stateKey)
      if (!context.identity || !state?.isOwner) {
        return
      }

      const existing = pending.get(state.key)

      if (existing) {
        existing.reject(error)
        pending.delete(state.key)
      }
    },

    finally(context) {
      const state = context.state.get(stateKey) as { isOwner: boolean; key: string } | undefined
      context.state.delete(stateKey)
      if (!context.identity || !state?.isOwner) {
        return
      }

      const existing = pending.get(state.key)

      if (existing) {
        existing.reject(new DedupeOwnerFinalizationError(state.key))
        pending.delete(state.key)
      }
    },
  }
}
