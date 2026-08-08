import { describe, expect, mock, test } from "bun:test"
import type { Decision, HookContext } from "../../lib/types"
import { cacheHook, dedupeHook } from "../recipes"

const providerMeta = { source: "provider" } as const

describe("cacheHook", () => {
  test("resolves from cache if available", async () => {
    const cachedDecision: Decision = { value: true }
    const cache = {
      get: mock(() => Promise.resolve(cachedDecision)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toEqual(cachedDecision)
    expect(cache.get).toHaveBeenCalledWith("test-flag:user123")
  })

  test("returns undefined if cache is empty", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toBeUndefined()
  })

  test("stores decision to cache after evaluation", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: false }

    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    expect(cache.set).toHaveBeenCalledWith("test-flag:user123", decision)
  })

  test("handles missing identity in resolve", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ value: true })),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toBeUndefined()
    expect(cache.get).not.toHaveBeenCalled()
  })

  test("handles missing identity in after", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }
    const decision: Decision = { value: true }

    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    expect(cache.set).not.toHaveBeenCalled()
  })

  test("uses correct cache key format with variant decision", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "theme-flag",
      identity: { distinctId: 456 },
    }
    const decision: Decision = { variant: "dark" }

    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    expect(cache.set).toHaveBeenCalledWith("theme-flag:456", decision)
  })

  test("creates different cache keys for different identities", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ value: true })),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context1: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user456" },
    }

    await Promise.resolve(hook.resolve?.(context1))
    await Promise.resolve(hook.resolve?.(context2))

    expect(cache.get).toHaveBeenCalledWith("test-flag:user123")
    expect(cache.get).toHaveBeenCalledWith("test-flag:user456")
  })

  test("creates different cache keys for different flags", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ value: true })),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context1: HookContext = {
      flagKey: "flag-a",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      flagKey: "flag-b",
      identity: { distinctId: "user123" },
    }

    await Promise.resolve(hook.resolve?.(context1))
    await Promise.resolve(hook.resolve?.(context2))

    expect(cache.get).toHaveBeenCalledWith("flag-a:user123")
    expect(cache.get).toHaveBeenCalledWith("flag-b:user123")
  })

  test("handles cache.get errors", async () => {
    const cache = {
      get: mock(() => Promise.reject(new Error("Cache read error"))),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await Promise.resolve(hook.resolve?.(context)).then(
      () => {
        throw new Error("Expected cache read to fail")
      },
      (error: unknown) => {
        expect((error as Error).message).toBe("Cache read error")
      }
    )
  })

  test("handles cache.set errors", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.reject(new Error("Cache write error"))),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    await Promise.resolve(hook.after?.(context, decision, providerMeta)).then(
      () => {
        throw new Error("Expected cache write to fail")
      },
      (error: unknown) => {
        expect((error as Error).message).toBe("Cache write error")
      }
    )
  })

  test("full cache flow: miss then hit", async () => {
    let stored: Decision | undefined
    const cache = {
      get: mock(() => Promise.resolve(stored)),
      set: mock((_key: string, value: Decision) => {
        stored = value
        return Promise.resolve()
      }),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // First resolve: cache miss
    const firstResult = await Promise.resolve(hook.resolve?.(context))
    expect(firstResult).toBeUndefined()
    expect(cache.get).toHaveBeenCalledTimes(1)

    // Store to cache
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))
    expect(cache.set).toHaveBeenCalledWith("test-flag:user123", decision)

    // Second resolve: cache hit
    const secondResult = await Promise.resolve(hook.resolve?.(context))
    expect(secondResult).toEqual(decision)
    expect(cache.get).toHaveBeenCalledTimes(2)
  })

  test("supports additional identity properties", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ value: true })),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      flagKey: "test-flag",
      identity: {
        distinctId: "user123",
        email: "user@example.com",
        plan: "pro",
      },
    }

    await Promise.resolve(hook.resolve?.(context))

    // Cache key should only use distinctId, not other properties
    expect(cache.get).toHaveBeenCalledWith("test-flag:user123")
  })
})

describe("dedupeHook", () => {
  test("allows first request to proceed normally", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

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
    const firstResolve = Promise.resolve(hook.resolve?.(context))
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request (should dedupe)
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Complete first request
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

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

    const result1 = await Promise.resolve(hook.resolve?.(context1))
    const result2 = await Promise.resolve(hook.resolve?.(context2))

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

    const result1 = await Promise.resolve(hook.resolve?.(context1))
    const result2 = await Promise.resolve(hook.resolve?.(context2))

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
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Trigger error on first request
    const error = new Error("API failed")
    await Promise.resolve(hook.error?.(context, error))

    // Second request should reject with same error
    await secondResolvePromise.then(
      () => {
        throw new Error("Expected deduplicated request to fail")
      },
      (error: unknown) => {
        expect((error as Error).message).toBe("API failed")
      }
    )
  })

  test("cleans up pending requests after success", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // First request
    await Promise.resolve(hook.resolve?.(context))
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await Promise.resolve(hook.resolve?.(context))
    expect(newResult).toBeUndefined()
  })

  test("cleans up pending requests after error", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    const firstResolve = Promise.resolve(hook.resolve?.(context))
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request to have a pending promise
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Trigger error which rejects the pending promise
    void hook.error?.(context, new Error("Failed"))

    // Wait for rejection
    try {
      await secondResolvePromise
    } catch (error) {
      expect((error as Error).message).toBe("Failed")
    }

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await Promise.resolve(hook.resolve?.(context))
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
    await Promise.resolve(hook.resolve?.(context1))

    // Start second concurrent request (should dedupe by flagKey only)
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context2))

    // Complete first request
    const decision: Decision = { value: false }
    await Promise.resolve(hook.after?.(context1, decision, providerMeta))

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
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Complete first request with variant
    const decision: Decision = { variant: "dark" }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("handles multiple concurrent requests (more than 2)", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start multiple concurrent requests
    const request2 = Promise.resolve(hook.resolve?.(context))
    const request3 = Promise.resolve(hook.resolve?.(context))
    const request4 = Promise.resolve(hook.resolve?.(context))

    // Complete first request
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // All concurrent requests should get the same decision
    expect(await request2).toEqual(decision)
    expect(await request3).toEqual(decision)
    expect(await request4).toEqual(decision)
  })

  test("after is no-op when no pending request exists", () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    expect(() => {
      void hook.after?.(context, decision, providerMeta)
    }).not.toThrow()
  })

  test("error is no-op when no pending request exists", () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    expect(() => {
      void hook.error?.(context, error)
    }).not.toThrow()
  })

  test("treats string and number distinctId as same key", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "123" },
    }
    const context2: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: 123 },
    }

    // Start first request with string distinctId
    await Promise.resolve(hook.resolve?.(context1))

    // Start second request with number distinctId - should dedupe
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context2))

    // Complete first request
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context1, decision, providerMeta))

    // Second request should get the same decision (treated as same key)
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("deduplicates requests with same numeric distinctId", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: 12_345 },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Complete first request
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("handles errors with multiple concurrent requests", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start multiple concurrent requests
    const request2 = Promise.resolve(hook.resolve?.(context))
    const request3 = Promise.resolve(hook.resolve?.(context))

    // Trigger error (don't await - let it reject the pending promises)
    const error = new Error("Failed")
    void hook.error?.(context, error)

    // All concurrent requests should reject with the same error
    try {
      await request2
      throw new Error("Should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("Failed")
    }

    try {
      await request3
      throw new Error("Should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("Failed")
    }
  })

  test("correctly deduplicates with null identity using flagKey only", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request with same flag but null identity
    const secondResolvePromise = Promise.resolve(hook.resolve?.(context))

    // Complete first request
    const decision: Decision = { value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("does not deduplicate different flags with null identity", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      flagKey: "flag-a",
      identity: null,
    }
    const context2: HookContext = {
      flagKey: "flag-b",
      identity: null,
    }

    const result1 = await Promise.resolve(hook.resolve?.(context1))
    const result2 = await Promise.resolve(hook.resolve?.(context2))

    // Both should return undefined (not deduplicated)
    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
  })

  test("interleaved requests for different flags work independently", async () => {
    const hook = dedupeHook()
    const contextA: HookContext = {
      flagKey: "flag-a",
      identity: { distinctId: "user123" },
    }
    const contextB: HookContext = {
      flagKey: "flag-b",
      identity: { distinctId: "user123" },
    }

    // Start first request for flag-a
    await Promise.resolve(hook.resolve?.(contextA))

    // Start concurrent requests for both flags
    const requestA2 = Promise.resolve(hook.resolve?.(contextA))
    const requestB1 = Promise.resolve(hook.resolve?.(contextB))
    const requestB2 = Promise.resolve(hook.resolve?.(contextB))

    // Complete both flags
    const decisionA: Decision = { value: true }
    const decisionB: Decision = { value: false }

    await Promise.resolve(hook.after?.(contextA, decisionA, providerMeta))
    await Promise.resolve(hook.after?.(contextB, decisionB, providerMeta))

    // Each flag's requests should get their respective decisions
    expect(await requestA2).toEqual(decisionA)
    expect(await requestB1).toBeUndefined() // First request for B
    expect(await requestB2).toEqual(decisionB)
  })
})
