// Recipes for common and useful hooks
import type { Decision, Hook, HookContext } from "../lib/types"
import { DedupeOwnerFinalizationError, HookResolutionAbortError } from "../lib/internal"
import { createHook } from "./index"

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

function getKey(context: HookContext) {
  if (context.identity) {
    return `${context.flagKey}:${context.identity.distinctId}`
  }
  return context.flagKey
}

function getCachedDecisionError(context: HookContext, decision: Decision): Error | undefined {
  const decisionKind = "variant" in decision ? "variant" : "boolean"

  if (context.kind !== decisionKind) {
    return new Error(
      `Cached decision type mismatch: expected ${context.kind} decision but received ${decisionKind}`
    )
  }

  if (
    context.kind === "variant" &&
    "variant" in decision &&
    !context.variants.includes(decision.variant)
  ) {
    return new Error(`Cached decision contains invalid variant: ${decision.variant}`)
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
      const cacheKey = getKey(context)
      const cachedDecision = await cache.get(cacheKey)
      if (!cachedDecision) {
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

      const cacheKey = getKey(context)
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
      const key = getKey(context)
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
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.resolve(decision)
        pending.delete(key)
      }
    },

    error(context, error) {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.reject(error)
        pending.delete(key)
      }
    },

    finally(context) {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing?.owner === context) {
        existing.reject(new DedupeOwnerFinalizationError(key))
        pending.delete(key)
      }
    },
  }
})
