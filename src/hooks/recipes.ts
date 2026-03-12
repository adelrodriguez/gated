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

function createDeferredPromise<T>() {
  let resolveFn!: (value: T) => void
  let rejectFn!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return { promise, reject: rejectFn, resolve: resolveFn }
}

export const dedupeHook = createHook(() => {
  type PendingRequest = {
    promise: Promise<Decision>
    resolve: (decision: Decision) => void
    reject: (error: unknown) => void
  }

  const pending = new Map<string, PendingRequest>()

  return {
    async resolve(context): Promise<Decision | undefined> {
      const key = getKey(context)
      const existing = pending.get(key)

      if (existing) {
        // Wait for the in-flight request to complete
        return await existing.promise
      }

      // Create a new pending promise for this request
      const deferred = createDeferredPromise<Decision>()

      pending.set(key, deferred)
      return undefined
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
