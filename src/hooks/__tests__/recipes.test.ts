import { describe, expect, mock, spyOn, test } from "bun:test"
import type { Decision, GateChanges, HookContext } from "../../lib/types"
import { decision } from "../../lib/decision"
import { cacheHook, dedupeHook } from "../recipes"

const providerMeta = { source: "provider" } as const
const BOOLEAN_HOOK_CONTEXT = {
  defaultValue: false,
  kind: "boolean",
  signal: new AbortController().signal,
  get state() {
    return new Map<unknown, unknown>()
  },
} as const

async function expectRejection<T>(promise: Promise<T>, message: string) {
  let caughtError: Error | undefined

  try {
    await promise
  } catch (error) {
    caughtError = error instanceof Error ? error : new Error(String(error))
  }

  expect(caughtError).toBeInstanceOf(Error)
  expect(caughtError).toMatchObject({ message })
  if (!caughtError) {
    throw new Error("Expected promise to reject")
  }
  return caughtError
}

function nextEvaluation<TContext extends HookContext>(context: TContext): TContext {
  return {
    ...context,
    signal: new AbortController().signal,
    state: new Map(),
  }
}

describe("cacheHook", () => {
  test("does not retain a reactive key index when changes are not configured", async () => {
    const cache = {
      get: mock((_key: string) => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "unindexed-flag",
      identity: { distinctId: "user123" },
    }
    const mapSet = spyOn(Map.prototype, "set")

    try {
      await Promise.resolve(hook.resolve?.(context))

      expect(
        mapSet.mock.calls.some(([key, value]) => key === "unindexed-flag" && value instanceof Set)
      ).toBe(false)
      expect(cache.get).toHaveBeenCalledWith('["unindexed-flag","string","user123"]')
    } finally {
      mapSet.mockRestore()
    }
  })

  test("resolves from cache if available", async () => {
    const cachedDecision: Decision = { type: "boolean", value: true }
    const cache = {
      get: mock(() => Promise.resolve(cachedDecision)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toEqual(cachedDecision)
    expect(cache.get).toHaveBeenCalledWith('["test-flag","string","user123"]')
  })

  test("returns undefined if cache is empty", async () => {
    const cache = {
      get: mock((_key: string) => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toBeUndefined()
  })

  test("treats a persisted pre-discriminant decision as a cache miss", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ value: true } as Decision)),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await Promise.resolve(hook.resolve?.(context))

    expect(result).toBeUndefined()
    expect(cache.get).toHaveBeenCalledWith('["test-flag","string","user123"]')
  })

  test("rejects a cached decision whose shape does not match the gate", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision>({ type: "boolean", value: true })),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const context: HookContext = {
      defaultValue: "light",
      flagKey: "theme",
      identity: { distinctId: "user123" },
      kind: "variant",
      signal: new AbortController().signal,
      state: new Map(),
      variants: ["light", "dark"],
    }

    await expectRejection(
      Promise.resolve(hook.resolve?.(context)),
      "Cached decision type mismatch: expected variant decision but received boolean"
    )
    expect(cache.get).toHaveBeenCalledWith('["theme","string","user123"]')
  })

  test("rejects a cached variant that the gate no longer supports", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision>({ type: "variant", variant: "dark" })),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const context: HookContext = {
      defaultValue: "light",
      flagKey: "theme",
      identity: { distinctId: "user123" },
      kind: "variant",
      signal: new AbortController().signal,
      state: new Map(),
      variants: ["light", "system"],
    }

    await expectRejection(
      Promise.resolve(hook.resolve?.(context)),
      "Cached decision contains invalid variant: dark"
    )
    expect(cache.get).toHaveBeenCalledWith('["theme","string","user123"]')
  })

  test("stores decision to cache after evaluation", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: false }

    await Promise.resolve(hook.resolve?.(context))
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    expect(cache.set).toHaveBeenCalledWith('["test-flag","string","user123"]', decision)
  })

  test("handles missing identity in resolve", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: null,
    }
    const decision: Decision = { type: "boolean", value: true }

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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "theme-flag",
      identity: { distinctId: 456 },
    }
    const decision: Decision = { type: "variant", variant: "dark" }

    await Promise.resolve(hook.resolve?.(context))
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    expect(cache.set).toHaveBeenCalledWith('["theme-flag","number","456"]', decision)
  })

  test("creates different cache keys for different identities", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context1: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user456" },
    }

    await Promise.resolve(hook.resolve?.(context1))
    await Promise.resolve(hook.resolve?.(context2))

    expect(cache.get).toHaveBeenCalledWith('["test-flag","string","user123"]')
    expect(cache.get).toHaveBeenCalledWith('["test-flag","string","user456"]')
  })

  test("creates different cache keys for different flags", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context1: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "flag-a",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "flag-b",
      identity: { distinctId: "user123" },
    }

    await Promise.resolve(hook.resolve?.(context1))
    await Promise.resolve(hook.resolve?.(context2))

    expect(cache.get).toHaveBeenCalledWith('["flag-a","string","user123"]')
    expect(cache.get).toHaveBeenCalledWith('["flag-b","string","user123"]')
  })

  test("handles cache.get errors", async () => {
    const cache = {
      get: mock(() => Promise.reject(new Error("Cache read error"))),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const error = await expectRejection(
      Promise.resolve(hook.resolve?.(context)),
      "Cache read error"
    )

    expect(error.message).toBe("Cache read error")
  })

  test("handles cache.set errors", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.reject(new Error("Cache write error"))),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: true }

    await Promise.resolve(hook.resolve?.(context))
    const error = await expectRejection(
      Promise.resolve(hook.after?.(context, decision, providerMeta)),
      "Cache write error"
    )

    expect(error.message).toBe("Cache write error")
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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // First resolve: cache miss
    const firstResult = await Promise.resolve(hook.resolve?.(context))
    expect(firstResult).toBeUndefined()
    expect(cache.get).toHaveBeenCalledTimes(1)

    // Store to cache
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))
    expect(cache.set).toHaveBeenCalledWith('["test-flag","string","user123"]', decision)

    // Second resolve: cache hit
    const secondResult = await Promise.resolve(hook.resolve?.(context))
    expect(secondResult).toEqual(decision)
    expect(cache.get).toHaveBeenCalledTimes(2)
  })

  test("supports additional identity properties", async () => {
    const cache = {
      get: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      set: mock(() => Promise.resolve()),
    }

    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: {
        distinctId: "user123",
        email: "user@example.com",
        plan: "pro",
      },
    }

    await Promise.resolve(hook.resolve?.(context))

    // Cache key should only use distinctId, not other properties
    expect(cache.get).toHaveBeenCalledWith('["test-flag","string","user123"]')
  })

  test("keeps delimiter and distinctId type boundaries in cache keys", async () => {
    const cache = {
      get: mock((_key: string) => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const contexts: HookContext[] = [
      { ...BOOLEAN_HOOK_CONTEXT, flagKey: "a:1", identity: { distinctId: "2" } },
      { ...BOOLEAN_HOOK_CONTEXT, flagKey: "a", identity: { distinctId: "1:2" } },
      { ...BOOLEAN_HOOK_CONTEXT, flagKey: "a", identity: { distinctId: 1 } },
      { ...BOOLEAN_HOOK_CONTEXT, flagKey: "a", identity: { distinctId: "1" } },
    ]

    const resolutions = contexts.map((context) => Promise.resolve(hook.resolve?.(context)))
    await Promise.all(resolutions)

    expect(cache.get.mock.calls.map(([key]) => key)).toEqual([
      '["a:1","string","2"]',
      '["a","string","1:2"]',
      '["a","number","1"]',
      '["a","string","1"]',
    ])
  })

  test("uses one attribute-sensitive key for cache lookup and write", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }
    let projectionCalls = 0
    const hook = cacheHook(cache, {
      key(context) {
        projectionCalls += 1
        return JSON.stringify([
          context.flagKey,
          context.identity?.distinctId,
          context.identity?.plan,
          projectionCalls,
        ])
      },
    })
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "beta-access",
      identity: { distinctId: "user123", plan: "pro" },
    }
    const decision: Decision = { type: "boolean", value: true }

    await Promise.resolve(hook.resolve?.(context))
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    const expectedKey = '["beta-access","user123","pro",1]'
    expect(cache.get).toHaveBeenCalledWith(expectedKey)
    expect(cache.set).toHaveBeenCalledWith(expectedKey, decision)
    expect(projectionCalls).toBe(1)
  })

  test("reads recipe state passed through an unsupported context clone", async () => {
    const cache = {
      get: mock((_key: string) => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }
    const hook = cacheHook(cache)
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "beta-access",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: true }

    await Promise.resolve(hook.resolve?.(context))
    const clonedContext = { ...context }
    await Promise.resolve(hook.after?.(clonedContext, decision, providerMeta))

    const stateDescriptor = Object.getOwnPropertyDescriptor(clonedContext, "state")
    expect(stateDescriptor && "value" in stateDescriptor).toBe(true)
    expect(cache.set).toHaveBeenCalledWith('["beta-access","string","user123"]', decision)
  })

  test("evicts notified flag keys and retains other cache entries", async () => {
    const entries = new Map<string, Decision>([
      ['["beta-access","string","user-1"]', decision.boolean(true)],
      ['["beta-access","string","user-2"]', decision.boolean(false)],
      ['["theme","string","user-1"]', decision.variant("dark")],
    ])
    let notify!: (keys?: readonly string[]) => void
    const changes: GateChanges = {
      subscribe(listener) {
        notify = listener
        return mock(() => null)
      },
    }
    const cache = {
      delete: mock(async (key: string) => {
        const deleted = entries.delete(key)
        await Promise.resolve()
        return deleted
      }),
      get: mock((key: string) => Promise.resolve(entries.get(key))),
      set: mock((key: string, value: Decision) => {
        entries.set(key, value)
        return Promise.resolve()
      }),
    }
    const hook = cacheHook(cache, { changes })
    const contexts: HookContext[] = [
      {
        ...BOOLEAN_HOOK_CONTEXT,
        flagKey: "beta-access",
        identity: { distinctId: "user-1" },
      },
      {
        ...BOOLEAN_HOOK_CONTEXT,
        flagKey: "beta-access",
        identity: { distinctId: "user-2" },
      },
      {
        defaultValue: "light",
        flagKey: "theme",
        identity: { distinctId: "user-1" },
        kind: "variant",
        signal: new AbortController().signal,
        state: new Map(),
        variants: ["light", "dark"],
      },
    ]
    await Promise.all(
      contexts.map((context) => Promise.resolve().then(() => hook.resolve?.(context)))
    )

    notify(["beta-access"])
    await Promise.resolve()

    expect(entries.has('["beta-access","string","user-1"]')).toBe(false)
    expect(entries.has('["beta-access","string","user-2"]')).toBe(false)
    expect(entries.has('["theme","string","user-1"]')).toBe(true)
  })
})

describe("dedupeHook", () => {
  test("allows first request to proceed normally", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    const firstResolve = Promise.resolve(hook.resolve?.(context))
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request (should dedupe)
    const secondResolvePromise = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Complete first request
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("does not dedupe different flags", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "flag-1",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user456" },
    }

    const result1 = await Promise.resolve(hook.resolve?.(context1))
    const result2 = await Promise.resolve(hook.resolve?.(context2))

    // Both should return undefined (not deduplicated)
    expect(result1).toBeUndefined()
    expect(result2).toBeUndefined()
  })

  test("does not deduplicate delimiter-colliding flag and identity pairs", async () => {
    const hook = dedupeHook()
    const firstContext: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "a:1",
      identity: { distinctId: "2" },
    }
    const secondContext: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "a",
      identity: { distinctId: "1:2" },
    }

    expect(await Promise.resolve(hook.resolve?.(firstContext))).toBeUndefined()
    expect(await Promise.resolve(hook.resolve?.(secondContext))).toBeUndefined()
  })

  test("uses an attribute-sensitive dedupe key projection", async () => {
    const hook = dedupeHook({
      key: (context) =>
        JSON.stringify([context.flagKey, context.identity?.distinctId, context.identity?.plan]),
    })
    const freeContext: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "beta-access",
      identity: { distinctId: "user123", plan: "free" },
    }
    const proContext: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "beta-access",
      identity: { distinctId: "user123", plan: "pro" },
    }

    expect(await Promise.resolve(hook.resolve?.(freeContext))).toBeUndefined()
    expect(await Promise.resolve(hook.resolve?.(proContext))).toBeUndefined()
  })

  test("computes a dedupe key once per evaluation", async () => {
    const projectedKeys = ["shared", "shared", "wrong-owner-key"]
    const key = mock(() => projectedKeys.shift() ?? "unexpected")
    const hook = dedupeHook({ key })
    const ownerContext: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "beta-access",
      identity: { distinctId: "user123" },
    }
    const followerContext: HookContext = {
      ...ownerContext,
      signal: new AbortController().signal,
      state: new Map(),
    }

    expect(await Promise.resolve(hook.resolve?.(ownerContext))).toBeUndefined()
    const follower = Promise.resolve(hook.resolve?.(followerContext))
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(ownerContext, decision, providerMeta))

    expect(await follower).toEqual(decision)
    expect(key).toHaveBeenCalledTimes(2)
  })

  test("handles errors in deduplicated requests", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Trigger error on first request
    const error = new Error("API failed")
    await Promise.resolve(hook.error?.(context, error))

    // Second request should reject with same error
    const rejectedError = await expectRejection(secondResolvePromise, "API failed")

    expect(rejectedError.message).toBe("API failed")
  })

  test("cleans up pending requests after success", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // First request
    await Promise.resolve(hook.resolve?.(context))
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await Promise.resolve(hook.resolve?.(nextEvaluation(context)))
    expect(newResult).toBeUndefined()
  })

  test("cleans up pending requests after error", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    const firstResolve = Promise.resolve(hook.resolve?.(context))
    expect(await firstResolve).toBeUndefined()

    // Start second concurrent request to have a pending promise
    const secondResolvePromise = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Trigger error which rejects the pending promise
    void hook.error?.(context, new Error("Failed"))

    // Wait for rejection
    try {
      await secondResolvePromise
    } catch (error) {
      expect((error as Error).message).toBe("Failed")
    }

    // New request should not be deduplicated (previous cleaned up)
    const newResult = await Promise.resolve(hook.resolve?.(nextEvaluation(context)))
    expect(newResult).toBeUndefined()
  })

  test("does not dedupe null identities", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: null,
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: null,
    }

    const firstResult = await Promise.resolve(hook.resolve?.(context1))
    const secondResult = await Promise.resolve(hook.resolve?.(context2))
    const decision: Decision = { type: "boolean", value: false }
    await Promise.resolve(hook.after?.(context1, decision, providerMeta))

    expect(firstResult).toBeUndefined()
    expect(secondResult).toBeUndefined()
  })

  test("supports variant decisions", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "theme-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Complete first request with variant
    const decision: Decision = { type: "variant", variant: "dark" }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("handles multiple concurrent requests (more than 2)", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start multiple concurrent requests
    const request2 = Promise.resolve(hook.resolve?.(nextEvaluation(context)))
    const request3 = Promise.resolve(hook.resolve?.(nextEvaluation(context)))
    const request4 = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Complete first request
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // All concurrent requests should get the same decision
    expect(await request2).toEqual(decision)
    expect(await request3).toEqual(decision)
    expect(await request4).toEqual(decision)
  })

  test("after is no-op when no pending request exists", () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: true }

    expect(() => {
      void hook.after?.(context, decision, providerMeta)
    }).not.toThrow()
  })

  test("error is no-op when no pending request exists", () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    expect(() => {
      void hook.error?.(context, error)
    }).not.toThrow()
  })

  test("does not deduplicate string and number distinctId values", async () => {
    const hook = dedupeHook()
    const context1: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "123" },
    }
    const context2: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: 123 },
    }

    // Start first request with string distinctId
    await Promise.resolve(hook.resolve?.(context1))

    const secondResult = await Promise.resolve(hook.resolve?.(context2))

    expect(secondResult).toBeUndefined()
  })

  test("deduplicates requests with same numeric distinctId", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: 12_345 },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start second concurrent request
    const secondResolvePromise = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

    // Complete first request
    const decision: Decision = { type: "boolean", value: true }
    await Promise.resolve(hook.after?.(context, decision, providerMeta))

    // Second request should get the same decision
    const secondResult = await secondResolvePromise
    expect(secondResult).toEqual(decision)
  })

  test("handles errors with multiple concurrent requests", async () => {
    const hook = dedupeHook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    // Start first request
    await Promise.resolve(hook.resolve?.(context))

    // Start multiple concurrent requests
    const request2 = Promise.resolve(hook.resolve?.(nextEvaluation(context)))
    const request3 = Promise.resolve(hook.resolve?.(nextEvaluation(context)))

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

  test("interleaved requests for different flags work independently", async () => {
    const hook = dedupeHook()
    const contextA: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "flag-a",
      identity: { distinctId: "user123" },
    }
    const contextB: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "flag-b",
      identity: { distinctId: "user123" },
    }

    // Start first request for flag-a
    await Promise.resolve(hook.resolve?.(contextA))

    // Start concurrent requests for both flags
    const requestA2 = Promise.resolve(hook.resolve?.(nextEvaluation(contextA)))
    const contextB2 = nextEvaluation(contextB)
    const requestB1 = Promise.resolve(hook.resolve?.(contextB))
    const requestB2 = Promise.resolve(hook.resolve?.(contextB2))

    // Complete both flags
    const decisionA: Decision = { type: "boolean", value: true }
    const decisionB: Decision = { type: "boolean", value: false }

    await Promise.resolve(hook.after?.(contextA, decisionA, providerMeta))
    await Promise.resolve(hook.after?.(contextB, decisionB, providerMeta))

    // Each flag's requests should get their respective decisions
    expect(await requestA2).toEqual(decisionA)
    expect(await requestB1).toBeUndefined() // First request for B
    expect(await requestB2).toEqual(decisionB)
  })
})
