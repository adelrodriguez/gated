import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, HookContext, HookErrorReport, Identity } from "../lib/types"
import { buildGate } from "../core"
import { cacheHook, dedupeHook } from "../hooks/recipes"
import { GateTimeoutError } from "../lib/errors"

function createDeferred<T>() {
  let rejectDeferred!: (reason?: Error) => void
  let resolveDeferred!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject
    resolveDeferred = resolve
  })

  return { promise, reject: rejectDeferred, resolve: resolveDeferred }
}

function never<T>(): Promise<T> {
  return new Promise<T>((resolve) => {
    void resolve
  })
}

function createMemoryCache(initialDecision?: Decision) {
  let stored = initialDecision

  return {
    get: mock(() => Promise.resolve(stored)),
    set: mock((_key: string, decision: Decision) => {
      stored = decision
      return Promise.resolve()
    }),
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Evaluation timed out"))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

async function expectRejection<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }

  throw new Error("Expected promise to reject")
}

function createFailingHook(
  phase: HookErrorReport["phase"],
  fail: () => never | Promise<never>
): Hook {
  switch (phase) {
    case "before":
      return { before: fail }
    case "resolve":
      return { resolve: fail }
    case "after":
      return { after: fail }
    case "error":
      return { error: fail }
    case "finally":
      return { finally: fail }
  }
}

describe("uniform hook lifecycle", () => {
  const recipeScenarios = [
    "cache-hit",
    "cache-miss",
    "provider-error",
    "concurrent-success",
    "concurrent-error",
  ] as const

  for (const order of ["dedupe-first", "cache-first"] as const) {
    for (const scenario of recipeScenarios) {
      const title =
        order === "dedupe-first" && scenario === "cache-hit"
          ? "regression: dedupe-before-cache must not hang (H1)"
          : `${order}: ${scenario}`

      test(title, async () => {
        const cache = createMemoryCache(
          scenario === "cache-hit" ? { type: "boolean", value: true } : undefined
        )
        const providerResult = createDeferred<Decision>()
        const decide = mock((): Promise<Decision> => {
          if (scenario === "provider-error") {
            return Promise.reject(new Error("Provider failed"))
          }
          if (scenario === "concurrent-success" || scenario === "concurrent-error") {
            return providerResult.promise
          }
          return Promise.resolve({ type: "boolean", value: true })
        })
        const cacheRecipe = cacheHook(cache)
        const dedupeRecipe = dedupeHook()
        const hooks =
          order === "dedupe-first" ? [dedupeRecipe, cacheRecipe] : [cacheRecipe, dedupeRecipe]
        const gate = buildGate({
          decide,
          hooks,
          identify: () => ({ distinctId: "user123" }),
        })
        const betaAccess = gate({ defaultValue: false, key: "beta-access" })

        if (scenario === "concurrent-success" || scenario === "concurrent-error") {
          const evaluations = [betaAccess(), betaAccess(), betaAccess(), betaAccess(), betaAccess()]
          await Bun.sleep(0)
          if (scenario === "concurrent-success") {
            providerResult.resolve({ type: "boolean", value: true })
          } else {
            providerResult.reject(new Error("Provider failed"))
          }
          expect(await settleWithin(Promise.all(evaluations), 75)).toEqual(
            scenario === "concurrent-success"
              ? [true, true, true, true, true]
              : [false, false, false, false, false]
          )

          if (scenario === "concurrent-error") {
            expect(await settleWithin(betaAccess(), 75)).toBe(false)
          }
        } else {
          const expected = scenario !== "provider-error"
          expect(await settleWithin(betaAccess(), 75)).toBe(expected)
          if (scenario === "cache-hit" || scenario === "cache-miss") {
            expect(await settleWithin(betaAccess(), 75)).toBe(true)
          }
        }

        expect(decide).toHaveBeenCalledTimes(
          scenario === "cache-hit" ? 0 : scenario === "concurrent-error" ? 2 : 1
        )
        expect(cache.set).toHaveBeenCalledTimes(
          scenario === "concurrent-success" && order === "cache-first"
            ? 5
            : scenario === "cache-miss" || scenario === "concurrent-success"
              ? 1
              : 0
        )
      })
    }
  }

  for (const source of ["hook", "provider", "default"] as const) {
    test(`runs the exact lifecycle order for a ${source} decision`, async () => {
      const events: string[] = []
      const gate = buildGate({
        decide: () => {
          events.push("provider")
          if (source === "default") {
            throw new Error("Provider failed")
          }
          return { type: "boolean", value: true }
        },
        hooks: [
          {
            after() {
              events.push("after")
            },
            before() {
              events.push("before")
            },
            error() {
              events.push("error")
            },
            finally() {
              events.push("finally")
            },
            resolve() {
              events.push("resolve")
              return source === "hook" ? { type: "boolean", value: true } : undefined
            },
          },
        ],
        identify: () => ({ distinctId: "user123" }),
      })

      expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(source !== "default")
      expect(events).toEqual(
        source === "hook"
          ? ["before", "resolve", "after", "finally"]
          : source === "provider"
            ? ["before", "resolve", "provider", "after", "finally"]
            : ["before", "resolve", "provider", "error", "finally"]
      )
    })
  }

  test("always settles across 100 hostile hook combinations", async () => {
    // Deterministic modulus schedules cover overlapping hostile phases without introducing flaky randomness.
    const evaluations = Array.from({ length: 100 }, (_, index) => {
      const fail = (phase: string): void => {
        throw new Error(`${phase}-${index}`)
      }
      const gate = buildGate({
        decide: () => {
          if (index % 17 === 0) {
            throw new Error(`provider-${index}`)
          }
          return { type: "boolean", value: true }
        },
        hooks: [
          {
            after:
              index % 5 === 0
                ? () => {
                    fail("after")
                  }
                : undefined,
            before:
              index % 7 === 0
                ? () => {
                    fail("before")
                  }
                : undefined,
            error:
              index % 3 === 0
                ? () => {
                    fail("error")
                  }
                : undefined,
            finally:
              index % 4 === 0
                ? () => {
                    fail("finally")
                  }
                : index % 2 === 0
                  ? () => Promise.reject(new Error(`finally-${index}`))
                  : undefined,
            resolve:
              index % 11 === 0
                ? () => Promise.reject(new Error(`resolve-${index}`))
                : index % 13 === 0
                  ? () => ({ type: "boolean", value: false })
                  : undefined,
          },
        ],
        identify: () => ({ distinctId: `user-${index}` }),
      })

      return settleWithin(gate({ defaultValue: false, key: "beta" })(), 75)
    })

    const results = await Promise.all(evaluations)
    const expected = Array.from(
      { length: 100 },
      (_, index) => !((index % 13 === 0 && index % 11 !== 0) || index % 17 === 0)
    )
    expect(results).toEqual(expected)
  })

  test("handles a leader rejection when there are no followers", async () => {
    const unhandledRejections: Error[] = []
    const onUnhandledRejection = (error: Error) => unhandledRejections.push(error)
    process.on("unhandledRejection", onUnhandledRejection)

    try {
      const gate = buildGate({
        decide: () => Promise.reject(new Error("Provider failed")),
        hooks: [dedupeHook()],
        identify: () => ({ distinctId: "user123" }),
      })
      const betaAccess = gate({ defaultValue: false, key: "beta-access" })

      expect(await betaAccess()).toBe(false)
      await Bun.sleep(0)
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }
  })

  test("passes decision source metadata to after hooks", async () => {
    const hookAfter = mock(() => Promise.resolve())
    const providerAfter = mock(() => Promise.resolve())
    const identity = { distinctId: "user123" }
    const hookDecision: Decision = { type: "boolean", value: true }
    const resolver: Hook = { resolve: () => hookDecision }
    const hookGate = buildGate({
      decide: () => ({ type: "boolean", value: false }),
      hooks: [resolver, { after: hookAfter }],
      identify: () => identity,
    })
    const providerGate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [{ after: providerAfter }],
      identify: () => identity,
    })

    expect(await hookGate({ defaultValue: false, key: "hook" })()).toBe(true)
    expect(await providerGate({ defaultValue: false, key: "provider" })()).toBe(true)
    expect(hookAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultValue: false,
        flagKey: "hook",
        identity,
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      }),
      hookDecision,
      { resolver, source: "hook" }
    )
    expect(providerAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultValue: false,
        flagKey: "provider",
        identity,
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      }),
      { type: "boolean", value: true },
      { source: "provider" }
    )
  })

  test("provides gate configuration to hooks for boolean and variant gates", async () => {
    const contexts: HookContext[] = []
    const identity = { distinctId: "user123" }
    const gate = buildGate({
      decide: (key) =>
        key === "theme" ? { type: "variant", variant: "dark" } : { type: "boolean", value: true },
      hooks: [
        {
          before(context) {
            contexts.push({ ...context })
          },
        },
      ],
      identify: () => identity,
    })

    await gate({ defaultValue: false, key: "beta-access" })()
    await gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })()

    expect(contexts).toEqual([
      {
        defaultValue: false,
        flagKey: "beta-access",
        identity,
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      },
      {
        defaultValue: "light",
        flagKey: "theme",
        identity,
        kind: "variant",
        signal: expect.any(AbortSignal),
        variants: ["light", "dark"],
      },
    ])
  })

  test("cacheHook replaces a cached decision whose shape does not match the gate", async () => {
    const cache = createMemoryCache({ type: "boolean", value: true })
    const decide = mock(() => Promise.resolve<Decision>({ type: "variant", variant: "dark" }))
    const reporter = mock(() => Promise.resolve())
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
      onHookError: reporter,
    })
    const theme = gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })

    expect(await theme()).toBe("dark")
    expect(await theme()).toBe("dark")
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("theme:user123", {
      type: "variant",
      variant: "dark",
    })
    expect(reporter).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith({
      context: expect.objectContaining({
        defaultValue: "light",
        flagKey: "theme",
        identity: { distinctId: "user123" },
        kind: "variant",
        signal: expect.any(AbortSignal),
        variants: ["light", "dark"],
      }),
      error: expect.objectContaining({
        message: "Cached decision type mismatch: expected variant decision but received boolean",
      }),
      hookIndex: 0,
      phase: "resolve",
    })
  })

  test("cacheHook replaces a cached variant that the gate no longer supports", async () => {
    const cache = createMemoryCache({ type: "variant", variant: "dark" })
    const decide = mock(() => Promise.resolve<Decision>({ type: "variant", variant: "system" }))
    const reporter = mock(() => Promise.resolve())
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
      onHookError: reporter,
    })
    const theme = gate({ defaultValue: "light", key: "theme", variants: ["light", "system"] })

    expect(await theme()).toBe("system")
    expect(await theme()).toBe("system")
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("theme:user123", {
      type: "variant",
      variant: "system",
    })
    expect(reporter).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith({
      context: expect.objectContaining({
        defaultValue: "light",
        flagKey: "theme",
        identity: { distinctId: "user123" },
        kind: "variant",
        signal: expect.any(AbortSignal),
        variants: ["light", "system"],
      }),
      error: expect.objectContaining({ message: "Cached decision contains invalid variant: dark" }),
      hookIndex: 0,
      phase: "resolve",
    })
  })

  test("cacheHook replaces a persisted decision without a type discriminant", async () => {
    const cache = createMemoryCache({ value: true } as Decision)
    const decide = mock(() => Promise.resolve<Decision>({ type: "boolean", value: false }))
    const reporter = mock(() => Promise.resolve())
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
      onHookError: reporter,
    })
    const betaAccess = gate({ defaultValue: true, key: "beta-access" })

    expect(await betaAccess()).toBe(false)
    expect(await betaAccess()).toBe(false)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("beta-access:user123", {
      type: "boolean",
      value: false,
    })
    expect(reporter).not.toHaveBeenCalled()
  })

  test("continues to the provider after an invalid hook decision", async () => {
    const after = mock(() => Promise.resolve())
    const cache = createMemoryCache()
    const providerDecision: Decision = { type: "variant", variant: "dark" }
    const decide = mock(() => providerDecision)
    const gate = buildGate({
      decide,
      hooks: [{ after, resolve: () => ({ type: "boolean", value: true }) }, cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const theme = gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })

    expect(await theme()).toBe("dark")
    expect(decide).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledWith(expect.anything(), providerDecision, {
      source: "provider",
    })
    expect(cache.set).toHaveBeenCalledWith("theme:user123", providerDecision)
  })

  test("continues to the provider after a null cache miss", async () => {
    const cache = {
      get: mock(() => Promise.resolve(null)),
      set: mock(() => Promise.resolve()),
    }
    const decide = mock(() => Promise.resolve<Decision>({ type: "boolean", value: true }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("beta-access:user123", {
      type: "boolean",
      value: true,
    })
  })

  test("replaces a stale cached variant with a valid provider decision", async () => {
    const cache = createMemoryCache({ variant: "dark" } as Decision)
    const decide = mock(() => Promise.resolve<Decision>({ type: "variant", variant: "midnight" }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "midnight"],
    })

    expect(await theme()).toBe("midnight")
    expect(await theme()).toBe("midnight")
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("theme:user123", {
      type: "variant",
      variant: "midnight",
    })
  })

  test("warms an earlier cache from a later cache hit", async () => {
    const memoryCache = createMemoryCache()
    const sharedCache = createMemoryCache({ type: "boolean", value: true })
    const decide = mock(() => Promise.resolve<Decision>({ type: "boolean", value: false }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(memoryCache), cacheHook(sharedCache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(await betaAccess()).toBe(true)
    expect(decide).not.toHaveBeenCalled()
    expect(memoryCache.set).toHaveBeenCalledWith("beta-access:user123", {
      type: "boolean",
      value: true,
    })
    expect(memoryCache.set).toHaveBeenCalledTimes(1)
    expect(sharedCache.get).toHaveBeenCalledTimes(1)
    expect(sharedCache.set).not.toHaveBeenCalled()
  })

  test("writes every consulted cache after a full miss", async () => {
    const memoryCache = createMemoryCache()
    const sharedCache = createMemoryCache()
    const decide = mock(() => Promise.resolve<Decision>({ type: "boolean", value: true }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(memoryCache), cacheHook(sharedCache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(memoryCache.set).toHaveBeenCalledTimes(1)
    expect(sharedCache.set).toHaveBeenCalledTimes(1)
  })

  test("does not duplicate cache writes when dedupe runs before cache", async () => {
    const providerResult = createDeferred<Decision>()
    const cache = createMemoryCache()
    const decide = mock(() => providerResult.promise)
    const gate = buildGate({
      decide,
      hooks: [dedupeHook(), cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const evaluations = [betaAccess(), betaAccess(), betaAccess(), betaAccess()]
    await Bun.sleep(0)
    providerResult.resolve({ type: "boolean", value: true })

    expect(await settleWithin(Promise.all(evaluations))).toEqual([true, true, true, true])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
  })

  test("records repeated cache writes when cache runs before dedupe", async () => {
    const providerResult = createDeferred<Decision>()
    const cache = createMemoryCache()
    const decide = mock(() => providerResult.promise)
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache), dedupeHook()],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const evaluations = [betaAccess(), betaAccess(), betaAccess(), betaAccess()]
    await Bun.sleep(0)
    providerResult.resolve({ type: "boolean", value: true })

    expect(await settleWithin(Promise.all(evaluations))).toEqual([true, true, true, true])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.get).toHaveBeenCalledTimes(4)
    expect(cache.set).toHaveBeenCalledTimes(4)
  })

  test("does not run after hooks for an out-of-list provider variant", async () => {
    const after = mock(() => Promise.resolve())
    const cache = createMemoryCache()
    const gate = buildGate({
      decide: () => ({ type: "variant", variant: "purple" }),
      hooks: [{ after }, cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const theme = gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })

    expect(await theme()).toBe("light")
    expect(after).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  test("a consumer-timed-out follower does not corrupt the leader entry", async () => {
    const providerResult = createDeferred<Decision>()
    const decide = mock(() => providerResult.promise)
    const gate = buildGate({
      decide,
      hooks: [dedupeHook()],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const leader = betaAccess()
    await Bun.sleep(0)
    const follower = betaAccess()

    const error = await expectRejection(settleWithin(follower, 5))

    expect(error.message).toBe("Evaluation timed out")

    providerResult.resolve({ type: "boolean", value: true })
    expect(await settleWithin(leader)).toBe(true)
    expect(await settleWithin(follower)).toBe(true)
    expect(decide).toHaveBeenCalledTimes(1)

    expect(await settleWithin(betaAccess())).toBe(true)
    expect(decide).toHaveBeenCalledTimes(2)
  })
})

describe("timeout and cancellation", () => {
  test("returns the default promptly and reports a factory timeout", async () => {
    const errorHook = mock(() => Promise.resolve())
    const finallyHook = mock(() => Promise.resolve())
    let providerSignal: AbortSignal | undefined
    const gate = buildGate({
      decide: (_key, _identity, options) => {
        providerSignal = options?.signal
        return never<Decision>()
      },
      hooks: [{ error: errorHook, finally: finallyHook }],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 25,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await settleWithin(betaAccess(), 1000)).toBe(false)
    await Bun.sleep(0)
    expect(errorHook).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(GateTimeoutError)
    )
    expect(finallyHook).toHaveBeenCalledTimes(1)
    expect(providerSignal?.aborted).toBe(true)
  })

  test("uses a per-gate timeout instead of the factory timeout", async () => {
    const gate = buildGate({
      decide: () => never<Decision>(),
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 1000,
    })
    const betaAccess = gate({
      defaultValue: false,
      key: "beta-access",
      timeoutMs: 10,
    })

    const details = await betaAccess.details()

    expect(details.source).toBe("default")
    expect(details.error).toBeInstanceOf(GateTimeoutError)
    expect((details.error as GateTimeoutError).timeoutMs).toBe(10)
  })

  test("returns the caller abort reason in evaluation details", async () => {
    const controller = new AbortController()
    const reason = new Error("request closed")
    const gate = buildGate({
      decide: () => never<Decision>(),
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    setTimeout(() => {
      controller.abort(reason)
    }, 10)

    expect(await betaAccess.details({ signal: controller.signal })).toEqual({
      error: reason,
      flagKey: "beta-access",
      source: "default",
      value: false,
    })
  })

  test("does not advance the lifecycle after an abandoned provider settles", async () => {
    const provider = createDeferred<Decision>()
    const after = mock(() => Promise.resolve())
    const finallyHook = mock(() => Promise.resolve())
    const gate = buildGate({
      decide: () => provider.promise,
      hooks: [{ after, finally: finallyHook }],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 10,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(false)
    provider.resolve({ type: "boolean", value: true })
    await provider.promise
    await Bun.sleep(0)

    expect(after).not.toHaveBeenCalled()
    expect(finallyHook).toHaveBeenCalledTimes(1)
  })

  test("a timeout during a hook prevents later operational stages", async () => {
    const resolve = mock(() => Promise.resolve<Decision | undefined>(void 0))
    const after = mock(() => Promise.resolve())
    const error = mock(() => Promise.resolve())
    const finallyHook = mock(() => Promise.resolve())
    const decide = mock(() => ({ type: "boolean", value: true }) as const)
    const gate = buildGate({
      decide,
      hooks: [
        {
          after,
          before: () => never<undefined>(),
          error,
          finally: finallyHook,
          resolve,
        },
      ],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 10,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(false)
    await Bun.sleep(0)

    expect(resolve).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(finallyHook).toHaveBeenCalledTimes(1)
  })

  test("preserves normal evaluation when no timeout is configured", async () => {
    let providerSignal: AbortSignal | undefined
    const gate = buildGate({
      decide: (_key, _identity, options) => {
        providerSignal = options?.signal
        return { type: "boolean", value: true }
      },
      identify: () => ({ distinctId: "user123" }),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    expect(providerSignal?.aborted).toBe(false)
  })

  test("consumes a late rejection from an abandoned provider", async () => {
    const unhandledRejection = mock(() => false)
    process.on("unhandledRejection", unhandledRejection)

    try {
      const gate = buildGate({
        decide: () =>
          new Promise<Decision>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("late provider rejection"))
            }, 20)
          }),
        identify: () => ({ distinctId: "user123" }),
        timeoutMs: 5,
      })

      expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(false)
      await Bun.sleep(30)
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandledRejection)
    }
  })

  test("bounds error hooks after an ordinary evaluation failure", async () => {
    const providerError = new Error("Provider failed")
    const error = mock(() => never<undefined>())
    const finallyHook = mock(() => Promise.resolve())
    const gate = buildGate({
      decide: () => Promise.reject(providerError),
      hooks: [{ error, finally: finallyHook }],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 10,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const details = await settleWithin(betaAccess.details(), 1000)

    expect(details.value).toBe(false)
    expect(details.source).toBe("default")
    expect(details.error).toBe(providerError)
    expect(error).toHaveBeenCalledTimes(1)
    expect(finallyHook).toHaveBeenCalledTimes(1)
  })

  test("bounds finally hooks on a successful decision", async () => {
    const finallyHook = mock(() => never<undefined>())
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [{ finally: finallyHook }],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 10,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const details = await settleWithin(betaAccess.details(), 1000)

    expect(details).toEqual({ flagKey: "beta-access", source: "provider", value: true })
    expect(finallyHook).toHaveBeenCalledTimes(1)
  })

  test("detaches the caller abort listener after a combined evaluation", async () => {
    const controller = new AbortController()
    const addEventListener = mock(controller.signal.addEventListener.bind(controller.signal))
    const removeEventListener = mock(controller.signal.removeEventListener.bind(controller.signal))
    Object.defineProperties(controller.signal, {
      addEventListener: { value: addEventListener },
      removeEventListener: { value: removeEventListener },
    })
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 1000,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess({ signal: controller.signal })).toBe(true)
    expect(addEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })
})

describe("anonymous identity policy", () => {
  test("keeps null identity rejection as the default", async () => {
    const error = mock(() => Promise.resolve())
    const decide = mock(() => ({ type: "boolean", value: true }) as const)
    const gate = buildGate({
      decide,
      hooks: [{ error }],
      identify: () => null,
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(false)
    expect(decide).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ identity: null }),
      expect.any(Error)
    )
  })

  test("allows a provider to evaluate a null identity when opted in", async () => {
    const decide = mock((_key: string, identity: Identity | null) => ({
      type: "boolean" as const,
      value: identity === null,
    }))
    const gate = buildGate({
      anonymous: "allow",
      decide,
      identify: () => null,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(await betaAccess.details()).toEqual({
      flagKey: "beta-access",
      source: "provider",
      value: true,
    })
    expect(decide).toHaveBeenCalledWith("beta-access", null, expect.any(Object))
  })

  test("passes a resolved identity through in anonymous mode", async () => {
    const identity = { distinctId: "user123" }
    const decide = mock((_key: string, resolved: Identity | null) => ({
      type: "boolean" as const,
      value: resolved === identity,
    }))
    const gate = buildGate({
      anonymous: "allow",
      decide,
      identify: () => identity,
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    expect(decide).toHaveBeenCalledWith("beta-access", identity, expect.any(Object))
  })

  test("bypasses cache reads and writes for anonymous evaluations", async () => {
    const cache = {
      get: mock(() => Promise.resolve<Decision | undefined>(void 0)),
      set: mock(() => Promise.resolve()),
    }
    const decide = mock(() => ({ type: "boolean", value: true }) as const)
    const gate = buildGate({
      anonymous: "allow",
      decide,
      hooks: [cacheHook(cache)],
      identify: () => null,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(await betaAccess()).toBe(true)
    expect(decide).toHaveBeenCalledTimes(2)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  test("does not deduplicate concurrent anonymous evaluations", async () => {
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const gate = buildGate({
      anonymous: "allow",
      decide,
      hooks: [dedupeHook()],
      identify: () => null,
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await Promise.all([betaAccess(), betaAccess(), betaAccess()])).toEqual([
      true,
      true,
      true,
    ])
    expect(decide).toHaveBeenCalledTimes(3)
    expect(await betaAccess()).toBe(true)
    expect(decide).toHaveBeenCalledTimes(4)
  })
})

describe("hook error policy", () => {
  const phases = ["before", "resolve", "after", "error", "finally"] as const
  const failureModes = ["synchronous", "asynchronous"] as const

  for (const phase of phases) {
    for (const failureMode of failureModes) {
      test(`reports a ${failureMode} ${phase} failure without changing the value`, async () => {
        const hookError = new Error(`${phase} hook failed`)
        const gateError = new Error("Provider failed")
        const fail =
          failureMode === "synchronous"
            ? () => {
                throw hookError
              }
            : () => Promise.reject(hookError)
        const reporter = mock(() => Promise.resolve())
        const laterResolve = mock(() => Promise.resolve<Decision | undefined>(void 0))
        const gateErrorHook = mock(() => Promise.resolve())
        const hooks: Hook[] = [{}, createFailingHook(phase, fail)]

        if (phase === "resolve") {
          hooks.push({ resolve: laterResolve })
        }

        if (phase !== "error") {
          hooks.push({ error: gateErrorHook })
        }

        const decide =
          phase === "error"
            ? mock(() => Promise.reject(gateError))
            : mock(() => Promise.resolve<Decision>({ type: "boolean", value: true }))
        const identity = { distinctId: "user123" }
        const gate = buildGate({
          decide,
          hooks,
          identify: () => identity,
          onHookError: reporter,
        })
        const betaAccess = gate({ defaultValue: false, key: "beta-access" })

        expect(await betaAccess()).toBe(phase !== "error")
        await Bun.sleep(0)
        expect(reporter).toHaveBeenCalledTimes(1)
        expect(reporter).toHaveBeenCalledWith({
          context: expect.objectContaining({
            defaultValue: false,
            flagKey: "beta-access",
            identity,
            kind: "boolean",
            signal: expect.any(AbortSignal),
            variants: undefined,
          }),
          error: hookError,
          hookIndex: 1,
          phase,
        })

        if (phase === "resolve") {
          expect(laterResolve).toHaveBeenCalled()
          expect(decide).toHaveBeenCalledTimes(1)
        }

        if (phase !== "error") {
          expect(gateErrorHook).not.toHaveBeenCalled()
        }
      })
    }
  }

  test("normalizes non-Error hook failures before reporting them", async () => {
    const reporter = mock(() => Promise.resolve())
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [
        {
          before() {
            const malformedFailure = "Hook failed" as never
            // oxlint-disable-next-line no-throw-literal, only-throw-error -- Simulate malformed JavaScript.
            throw malformedFailure
          },
        },
      ],
      identify: () => ({ distinctId: "user123" }),
      onHookError: reporter,
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    await Bun.sleep(0)
    expect(reporter).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: "Hook failed" }) })
    )
  })

  test("normalizes non-Error gate failures before running error hooks", async () => {
    const onError = mock(() => Promise.resolve())
    const gate = buildGate({
      decide() {
        const malformedFailure = "Provider failed" as never
        // oxlint-disable-next-line no-throw-literal, only-throw-error -- Simulate malformed JavaScript.
        throw malformedFailure
      },
      hooks: [{ error: onError }],
      identify: () => ({ distinctId: "user123" }),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(false)
    expect(onError).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ message: "Provider failed" })
    )
  })

  for (const reporterBehavior of ["throws", "rejects", "never settles"] as const) {
    test(`does not wait when onHookError ${reporterBehavior}`, async () => {
      const reporter =
        reporterBehavior === "throws"
          ? mock(() => {
              throw new Error("Reporter failed")
            })
          : reporterBehavior === "rejects"
            ? mock(() => Promise.reject(new Error("Reporter failed")))
            : mock(
                () =>
                  new Promise<void>(() => {
                    // This reporter intentionally never settles.
                  })
              )
      const gate = buildGate({
        decide: () => ({ type: "boolean", value: true }),
        hooks: [
          {
            before() {
              throw new Error("Hook failed")
            },
          },
          {
            before() {
              throw new Error("Second hook failed")
            },
          },
        ],
        identify: () => ({ distinctId: "user123" }),
        onHookError: reporter,
      })
      const betaAccess = gate({ defaultValue: false, key: "beta-access" })

      expect(await settleWithin(betaAccess())).toBe(true)
      await Bun.sleep(0)
      expect(reporter).toHaveBeenCalledTimes(2)
    })
  }

  test("continues silently when no hook error reporter is configured", async () => {
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [
        {
          before() {
            throw new Error("Before failed")
          },
        },
        {
          after: () => Promise.reject(new Error("After failed")),
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
  })
})
