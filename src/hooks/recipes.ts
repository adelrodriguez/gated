// Recipes for common and useful hooks
import type { Decision, Hook, HookContext, IdentityValue } from "../lib/types"
import { DedupeOwnerFinalizationError, HookResolutionAbortError } from "../lib/internal"
import { createHook } from "./index"

/**
 * Cache implementations own serialization. A variant payload may contain provider metadata that is
 * not JSON-safe, so persisted caches must either preserve it faithfully or normalize it.
 */
export interface Cache {
  get: (key: string) => Promise<Decision | null | undefined>
  set: (key: string, value: Decision) => Promise<void>
}

interface PendingRequest {
  owner: HookContext
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

function createPendingRequest(owner: HookContext): PendingRequest {
  let controls:
    | {
        reject: (error: Error) => void
        resolve: (decision: Decision) => void
      }
    | undefined

  const promise = new Promise<Decision>((resolve, reject) => {
    controls = { reject, resolve }
  })
  void promise.catch(() => null)

  return {
    owner,
    promise,
    reject(error) {
      controls?.reject(new HookResolutionAbortError(error))
    },
    resolve(decision) {
      controls?.resolve(decision)
    },
  }
}

function getKey(flagKey: string, distinctId: NonNullable<HookContext["identity"]>["distinctId"]) {
  return `${flagKey}:${distinctId}`
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

export const cacheHook: (cache: Cache) => Hook = createHook<Cache>((cache) => {
  const consulted = new WeakSet<HookContext>()
  const hook: Hook = {
    async resolve(context) {
      if (!context.identity) {
        return
      }

      consulted.add(context)
      const cacheKey = getKey(context.flagKey, context.identity.distinctId)
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
      const wasConsulted = consulted.delete(context)

      if (
        !context.identity ||
        !wasConsulted ||
        (meta.source === "hook" && meta.resolver === hook)
      ) {
        return
      }

      const cacheKey = getKey(context.flagKey, context.identity.distinctId)
      await cache.set(cacheKey, decision)
    },

    finally(context) {
      consulted.delete(context)
    },
  }

  return hook
})

export const dedupeHook: () => Hook = createHook(() => {
  const pending = new Map<string, PendingRequest>()

  return {
    async resolve(context) {
      if (!context.identity) {
        return
      }

      const key = getKey(context.flagKey, context.identity.distinctId)
      const existing = pending.get(key)
      const result = existing?.promise

      if (result) {
        // Wait for the in-flight request to complete
        return await result
      }

      pending.set(key, createPendingRequest(context))

      // Return undefined to let the normal flow continue
      return result
    },

    after(context, decision) {
      if (!context.identity) {
        return
      }

      const key = getKey(context.flagKey, context.identity.distinctId)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.resolve(decision)
        pending.delete(key)
      }
    },

    error(context, error) {
      if (!context.identity) {
        return
      }

      const key = getKey(context.flagKey, context.identity.distinctId)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.reject(error)
        pending.delete(key)
      }
    },

    finally(context) {
      if (!context.identity) {
        return
      }

      const key = getKey(context.flagKey, context.identity.distinctId)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.reject(new DedupeOwnerFinalizationError(key))
        pending.delete(key)
      }
    },
  }
})
