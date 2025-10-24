import { describe, expect, mock, test } from "bun:test"
import type { Decision, HookContext } from "../../lib/types"
import { cacheHook, dedupeHook } from "../recipes"

describe("cacheHook", () => {
  test("resolves from cache if available", async () => {
    const cachedDecision: Decision = { value: true }
    const cache = {
      get: mock(async () => cachedDecision),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await hook.resolve?.(context)

    expect(result).toEqual(cachedDecision)
    expect(cache.get).toHaveBeenCalledWith("test-flag:user123")
  })

  test("returns undefined if cache is empty", async () => {
    const cache = {
      // biome-ignore lint/nursery/noUselessUndefined: Empty function
      get: mock(async (): Promise<Decision | undefined> => undefined),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await hook.resolve?.(context)

    expect(result).toBeUndefined()
  })

  test("stores decision to cache after evaluation", async () => {
    const cache = {
      // biome-ignore lint/nursery/noUselessUndefined: Empty function
      get: mock(async (): Promise<Decision | undefined> => undefined),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: false }

    await hook.after?.(context, decision)

    expect(cache.set).toHaveBeenCalledWith("test-flag:user123", decision)
  })

  test("handles missing identity in resolve", async () => {
    const cache = {
      get: mock(async () => ({ value: true })),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }

    const result = await hook.resolve?.(context)

    expect(result).toBeUndefined()
    expect(cache.get).not.toHaveBeenCalled()
  })

  test("handles missing identity in after", async () => {
    const cache = {
      // biome-ignore lint/nursery/noUselessUndefined: Empty function
      get: mock(async (): Promise<Decision | undefined> => undefined),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }
    const decision: Decision = { value: true }

    await hook.after?.(context, decision)

    expect(cache.set).not.toHaveBeenCalled()
  })

  test("uses correct cache key format with variant decision", async () => {
    const cache = {
      // biome-ignore lint/nursery/noUselessUndefined: Empty function
      get: mock(async (): Promise<Decision | undefined> => undefined),
      set: mock(async () => {
        // Store to cache
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "theme-flag",
      identity: { distinctId: 456 },
    }
    const decision: Decision = { variant: "dark" }

    await hook.after?.(context, decision)

    expect(cache.set).toHaveBeenCalledWith("theme-flag:456", decision)
  })
})

describe("dedupeHook", () => {
  test("allows first request to proceed normally", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await hook.resolve?.(context)

    // First request should return undefined (let flow continue)
    expect(result).toBeUndefined()
  })

  test("deduplicates concurrent requests for same flag+identity", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    const firstResolve = hook.resolve?.(context)
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request (should dedupe)
    const secondResolvePromise = hook.resolve?.(context)

    // Complete first request
    const decision: Decision = { value: true }
    await hook.after?.(context, decision)

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("does not dedupe different flags", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      flagKey: "flag-1",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      flagKey: "flag-2",
      identity: { distinctId: "user123" },
    }

    const result1 = await hook.resolve?.(context1)
    const result2 = await hook.resolve?.(context2)

    // Both should return undefined (not deduplicated)
    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
  })

  test("does not dedupe different identities", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user456" },
    }

    const result1 = await hook.resolve?.(context1)
    const result2 = await hook.resolve?.(context2)

    // Both should return undefined (not deduplicated)
    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
  })

  test("handles errors in deduplicated requests", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await hook.resolve?.(context)

    // Start second concurrent request
    const secondResolvePromise = hook.resolve?.(context)

    // Trigger error on first request
    const error = new Error("API failed")
    await hook.error?.(context, error)

    // Second request should reject with same error
    await expect(secondResolvePromise).rejects.toThrow("API failed")
  })

  test("cleans up pending requests after success", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // First request
    await hook.resolve?.(context)
    const decision: Decision = { value: true }
    await hook.after?.(context, decision)

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await hook.resolve?.(context)
    expect(newResult).toBeUndefined()
  })

  test("cleans up pending requests after error", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    const firstResolve = hook.resolve?.(context)
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request to have a pending promise
    const secondResolvePromise = hook.resolve?.(context)

    // Trigger error which rejects the pending promise
    hook.error?.(context, new Error("Failed"))

    // Wait for rejection
    try {
      await secondResolvePromise
    } catch (error) {
      expect((error as Error).message).toBe("Failed")
    }

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await hook.resolve?.(context)
    expect(newResult).toBeUndefined()
  })

  test("handles null identity", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }
    const context2: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }

    // Start first request
    await hook.resolve?.(context1)

    // Start second concurrent request (should dedupe by flagKey only)
    const secondResolvePromise = hook.resolve?.(context2)

    // Complete first request
    const decision: Decision = { value: false }
    await hook.after?.(context1, decision)

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("supports variant decisions", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "theme-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await hook.resolve?.(context)

    // Start second concurrent request
    const secondResolvePromise = hook.resolve?.(context)

    // Complete first request with variant
    const decision: Decision = { variant: "dark" }
    await hook.after?.(context, decision)

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })
})
