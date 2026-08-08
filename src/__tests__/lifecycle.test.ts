import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook } from "../lib/types"
import { buildGate } from "../core"
import { cacheHook, dedupeHook } from "../hooks/recipes"

function createDeferred<T>() {
  let rejectDeferred!: (reason?: unknown) => void
  let resolveDeferred!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject
    resolveDeferred = resolve
  })

  return { promise, reject: rejectDeferred, resolve: resolveDeferred }
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

describe("uniform hook lifecycle", () => {
  for (const order of ["dedupe-first", "cache-first"] as const) {
    test(`cache and dedupe remain correct with ${order}`, async () => {
      const cache = createMemoryCache()
      const cacheRecipe = cacheHook(cache)
      const dedupeRecipe = dedupeHook()
      const decide = mock(() => Promise.resolve<Decision>({ value: true }))
      const hooks =
        order === "dedupe-first" ? [dedupeRecipe, cacheRecipe] : [cacheRecipe, dedupeRecipe]
      const gate = buildGate({
        decide,
        hooks,
        identify: () => ({ distinctId: "user123" }),
      })
      const betaAccess = gate({ defaultValue: false, key: "beta-access" })

      expect(await settleWithin(betaAccess())).toBe(true)
      expect(await settleWithin(betaAccess())).toBe(true)
      expect(await settleWithin(betaAccess())).toBe(true)
      expect(decide).toHaveBeenCalledTimes(1)
      expect(cache.set).toHaveBeenCalledTimes(1)
    })
  }

  test("deduplicates concurrent provider decisions", async () => {
    const providerResult = createDeferred<Decision>()
    const decide = mock(() => providerResult.promise)
    const gate = buildGate({
      decide,
      hooks: [dedupeHook()],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const evaluations = [betaAccess(), betaAccess(), betaAccess()]
    await Bun.sleep(0)
    providerResult.resolve({ value: true })

    expect(await settleWithin(Promise.all(evaluations))).toEqual([true, true, true])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  test("releases every follower after a provider error and starts fresh", async () => {
    const firstAttempt = createDeferred<Decision>()
    const decide = mock(() =>
      decide.mock.calls.length === 1 ? firstAttempt.promise : Promise.resolve({ value: true })
    )
    const gate = buildGate({
      decide,
      hooks: [dedupeHook()],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    const evaluations = [betaAccess(), betaAccess(), betaAccess()]
    await Bun.sleep(0)
    firstAttempt.reject(new Error("Provider failed"))

    expect(await settleWithin(Promise.all(evaluations))).toEqual([false, false, false])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(await settleWithin(betaAccess())).toBe(true)
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("handles a leader rejection when there are no followers", async () => {
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (error: unknown) => unhandledRejections.push(error)
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
    const hookDecision: Decision = { value: true }
    const resolver: Hook = { resolve: () => hookDecision }
    const hookGate = buildGate({
      decide: () => ({ value: false }),
      hooks: [resolver, { after: hookAfter }],
      identify: () => identity,
    })
    const providerGate = buildGate({
      decide: () => ({ value: true }),
      hooks: [{ after: providerAfter }],
      identify: () => identity,
    })

    expect(await hookGate({ defaultValue: false, key: "hook" })()).toBe(true)
    expect(await providerGate({ defaultValue: false, key: "provider" })()).toBe(true)
    expect(hookAfter).toHaveBeenCalledWith({ flagKey: "hook", identity }, hookDecision, {
      resolver,
      source: "hook",
    })
    expect(providerAfter).toHaveBeenCalledWith(
      { flagKey: "provider", identity },
      { value: true },
      { source: "provider" }
    )
  })

  test("continues to the provider after an invalid hook decision", async () => {
    const after = mock(() => Promise.resolve())
    const cache = createMemoryCache()
    const providerDecision: Decision = { variant: "dark" }
    const decide = mock(() => providerDecision)
    const gate = buildGate({
      decide,
      hooks: [{ after, resolve: () => ({ value: true }) }, cacheHook(cache)],
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
    const decide = mock(() => Promise.resolve<Decision>({ value: true }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith("beta-access:user123", { value: true })
  })

  test("replaces a stale cached variant with a valid provider decision", async () => {
    const cache = createMemoryCache({ variant: "dark" })
    const decide = mock(() => Promise.resolve<Decision>({ variant: "midnight" }))
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
    expect(cache.set).toHaveBeenCalledWith("theme:user123", { variant: "midnight" })
  })

  test("warms an earlier cache from a later cache hit", async () => {
    const memoryCache = createMemoryCache()
    const sharedCache = createMemoryCache({ value: true })
    const decide = mock(() => Promise.resolve<Decision>({ value: false }))
    const gate = buildGate({
      decide,
      hooks: [cacheHook(memoryCache), cacheHook(sharedCache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaAccess()).toBe(true)
    expect(decide).not.toHaveBeenCalled()
    expect(memoryCache.set).toHaveBeenCalledWith("beta-access:user123", { value: true })
    expect(sharedCache.set).not.toHaveBeenCalled()
  })

  test("does not run after hooks for an out-of-list provider variant", async () => {
    const after = mock(() => Promise.resolve())
    const cache = createMemoryCache()
    const gate = buildGate({
      decide: () => ({ variant: "purple" }),
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

    await settleWithin(follower, 5).then(
      () => {
        throw new Error("Expected the consumer timeout to win")
      },
      (error: unknown) => {
        expect((error as Error).message).toBe("Evaluation timed out")
      }
    )

    providerResult.resolve({ value: true })
    expect(await settleWithin(leader)).toBe(true)
    expect(await settleWithin(follower)).toBe(true)
    expect(decide).toHaveBeenCalledTimes(1)

    expect(await settleWithin(betaAccess())).toBe(true)
    expect(decide).toHaveBeenCalledTimes(2)
  })
})
