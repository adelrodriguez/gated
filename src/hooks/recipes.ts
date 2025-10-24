// Recipes for common and useful hooks
import type { Decision, HookContext } from "../lib/types"
import { createHook } from "./index"

export interface Cache {
  get: (key: string) => Promise<Decision | undefined>
  set: (key: string, value: Decision) => Promise<void>
}

function getKey(context: HookContext) {
  if (context.identity) {
    return `${context.flagKey}:${context.identity.distinctId}`
  }
  return context.flagKey
}

export const cacheHook = createHook<Cache>((cache) => ({
  async resolve(context) {
    if (!context.identity) {
      return
    }

    const cacheKey = getKey(context)
    return await cache.get(cacheKey)
  },

  async after(context, decision) {
    if (!context.identity) {
      return
    }

    const cacheKey = getKey(context)
    await cache.set(cacheKey, decision)
  },
}))

export const dedupeHook = createHook(() => {
  type PendingRequest = {
    promise: Promise<Decision>
    resolve: (decision: Decision) => void
    reject: (error: unknown) => void
  }

  const pending = new Map<string, PendingRequest>()

  return {
    async resolve(context) {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing) {
        // Wait for the in-flight request to complete
        return await existing.promise
      }

      // Create a new pending promise for this request
      let resolvePromise: (decision: Decision) => void = () => {
        // no-op
      }
      let rejectPromise: (error: unknown) => void = () => {
        // no-op
      }
      const promise = new Promise<Decision>((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      pending.set(key, {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
      })

      // Return undefined to let the normal flow continue
      return
    },

    after(context, decision) {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing) {
        existing.resolve(decision)
        pending.delete(key)
      }
    },

    error(context, error) {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing) {
        existing.reject(error)
        pending.delete(key)
      }
    },
  }
})
