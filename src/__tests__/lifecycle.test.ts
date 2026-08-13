import { describe, expect, mock, test } from "bun:test"
import type { DecisionCacheErrorReport, Decision, HookContext, HookErrorReport } from "../lib/types"
import { buildGate } from "../factory"
import { GateTimeoutError, InvalidVariantError } from "../lib/errors"

function createDeferred<T>() {
  let rejectDeferred!: (reason?: Error) => void
  let resolveDeferred!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject
    resolveDeferred = resolve
  })
  return { promise, reject: rejectDeferred, resolve: resolveDeferred }
}

async function flushBackground(): Promise<void> {
  await Bun.sleep(0)
  await Bun.sleep(0)
}

describe("observer hook lifecycle", () => {
  test("shares one stable context through successful observer phases", async () => {
    const starts = new WeakMap<HookContext, number>()
    const contexts: HookContext[] = []
    const values: number[] = []
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [
        {
          after(context) {
            contexts.push(context)
            values.push(starts.get(context) ?? 0)
          },
          before(context) {
            contexts.push(context)
            starts.set(context, 42)
          },
          finally(context) {
            contexts.push(context)
            values.push(starts.get(context) ?? 0)
            starts.delete(context)
          },
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    await flushBackground()

    expect(values).toEqual([42, 42])
    expect(contexts.every((context) => context === contexts[0])).toBe(true)
  })

  test("reports cache and provider decision sources to after hooks", async () => {
    const sources: string[] = []
    const cache = new Map<string, Decision>()
    const gate = buildGate({
      cache: {
        get: (key) => Promise.resolve(cache.get(key)),
        set: (key, value) => {
          cache.set(key, value)
          return Promise.resolve()
        },
      },
      decide: () => ({ type: "boolean", value: true }),
      hooks: [{ after: (_context, _decision, meta) => void sources.push(meta.source) }],
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    const providerDetails = await evaluator.details()
    expect(providerDetails.source).toBe("provider")
    await flushBackground()
    const cacheDetails = await evaluator.details()
    expect(cacheDetails.source).toBe("cache")
    await flushBackground()
    expect(sources).toEqual(["provider", "cache"])
  })

  test("returns after an abort while error hooks continue to completion", async () => {
    const errorHookStarted = createDeferred<null>()
    const releaseErrorHook = createDeferred<null>()
    const finallyHook = mock(() => Promise.resolve())
    const controller = new AbortController()
    const gate = buildGate({
      decide: () => {
        throw new Error("provider failed")
      },
      hooks: [
        {
          error: async () => {
            errorHookStarted.resolve(null)
            await releaseErrorHook.promise
          },
          finally: finallyHook,
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluation = gate({ defaultValue: false, key: "beta-access" }).details({
      signal: controller.signal,
    })
    await errorHookStarted.promise

    controller.abort(new Error("caller stopped"))
    const details = await evaluation

    expect(details).toMatchObject({ source: "default", value: false })
    expect(finallyHook).toHaveBeenCalledTimes(1)
    releaseErrorHook.resolve(null)
    await flushBackground()
  })

  test("does not await error hooks when the signal is already aborted", async () => {
    const releaseErrorHook = createDeferred<null>()
    const controller = new AbortController()
    controller.abort(new Error("caller stopped"))
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      hooks: [
        {
          error: async () => {
            await releaseErrorHook.promise
          },
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })

    const details = await gate({ defaultValue: false, key: "beta-access" }).details({
      signal: controller.signal,
    })

    expect(details.error?.message).toBe("caller stopped")
    releaseErrorHook.resolve(null)
  })

  for (const phase of ["before", "after", "error", "finally"] as const) {
    test(`reports a ${phase} observer failure without changing the result`, async () => {
      const reports: HookErrorReport[] = []
      const fail = () => {
        throw new Error(`${phase} failed`)
      }
      const hook =
        phase === "before"
          ? { before: fail }
          : phase === "after"
            ? { after: fail }
            : phase === "error"
              ? { error: fail }
              : { finally: fail }
      const gate = buildGate({
        decide: () => {
          if (phase === "error") {
            throw new Error("provider failed")
          }
          return { type: "boolean", value: true }
        },
        hooks: [hook],
        identify: () => ({ distinctId: "user123" }),
        onHookError: (report) => void reports.push(report),
      })

      expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(phase !== "error")
      await flushBackground()
      expect(reports).toHaveLength(1)
      expect(reports[0]?.phase).toBe(phase)
    })
  }
})

describe("first-class cache", () => {
  test("uses the default evaluation key for a miss, write, and hit", async () => {
    const stored = new Map<string, Decision>()
    const get = mock((key: string) => Promise.resolve(stored.get(key)))
    const set = mock((key: string, decision: Decision) => {
      stored.set(key, decision)
      return Promise.resolve()
    })
    const decide = mock(() => ({ type: "variant", variant: "dark" }) as const)
    const gate = buildGate({
      cache: { get, set },
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const theme = gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })

    const providerDetails = await theme.details()
    expect(providerDetails.source).toBe("provider")
    await flushBackground()
    expect(set).toHaveBeenCalledWith('["theme","variant",["light","dark"],"string","user123"]', {
      type: "variant",
      variant: "dark",
    })
    const cacheDetails = await theme.details()
    expect(cacheDetails.source).toBe("cache")
    expect(decide).toHaveBeenCalledTimes(1)
  })

  test("supports a custom identity-sensitive key", async () => {
    const keys: string[] = []
    const gate = buildGate<{ distinctId: string; tenant: string }>({
      cache: {
        get: (key) => {
          keys.push(key)
          return Promise.resolve(null)
        },
        set: () => Promise.resolve(),
      },
      decide: () => ({ type: "boolean", value: true }),
      evaluationKey: (context) => `${context.identity?.tenant}:${context.flagKey}`,
      identify: () => ({ distinctId: "user123", tenant: "acme" }),
    })

    await gate({ defaultValue: false, key: "beta-access" })()
    expect(keys).toEqual(["acme:beta-access"])
  })

  test("reports custom cache key failures without reading the store", async () => {
    const reports: DecisionCacheErrorReport[] = []
    const error = new Error("key failed")
    const get = mock(() => Promise.resolve(null))
    const gate = buildGate({
      cache: {
        get,
        set: () => Promise.resolve(),
      },
      decide: () => ({ type: "boolean", value: true }),
      evaluationKey: () => {
        throw error
      },
      identify: () => ({ distinctId: "user123" }),
      onCacheError: (report) => void reports.push(report),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    await flushBackground()

    expect(get).not.toHaveBeenCalled()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      error,
      flagKey: "beta-access",
      key: "beta-access",
      operation: "key",
    })
  })

  test("keeps numeric and string identity keys separate", async () => {
    const stored = new Map<string, Decision>()
    const decide = mock((_key: string, identity: { distinctId: number | string }) => ({
      type: "boolean" as const,
      value: typeof identity.distinctId === "number",
    }))
    const gate = buildGate<{ distinctId: number | string }>({
      cache: {
        get: (key) => Promise.resolve(stored.get(key)),
        set: (key, value) => {
          stored.set(key, value)
          return Promise.resolve()
        },
      },
      decide,
      identify: () => ({ distinctId: "unused" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    expect(await evaluator({ identity: { distinctId: 1 } })).toBe(true)
    expect(await evaluator({ identity: { distinctId: "1" } })).toBe(false)
    await flushBackground()
    expect(await evaluator({ identity: { distinctId: 1 } })).toBe(true)
    expect(await evaluator({ identity: { distinctId: "1" } })).toBe(false)
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("treats an invalid cached decision as a miss, reports it, and evicts it", async () => {
    const reports: DecisionCacheErrorReport[] = []
    const remove = mock(() => Promise.resolve(true))
    const set = mock(() => Promise.resolve())
    const decide = mock(() => ({ type: "variant", variant: "dark" }) as const)
    const gate = buildGate({
      cache: {
        delete: remove,
        get: () => Promise.resolve({ type: "variant", variant: "stale" }),
        set,
      },
      decide,
      identify: () => ({ distinctId: "user123" }),
      onCacheError: (report) => void reports.push(report),
    })

    expect(await gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })()).toBe(
      "dark"
    )
    await flushBackground()

    expect(decide).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledTimes(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.operation).toBe("validate")
    expect(reports[0]?.error).toBeInstanceOf(InvalidVariantError)
  })

  test("reports get and set failures without failing evaluation", async () => {
    const reports: DecisionCacheErrorReport[] = []
    const gate = buildGate({
      cache: {
        get: () => Promise.reject(new Error("read failed")),
        set: () => Promise.reject(new Error("write failed")),
      },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
      onCacheError: (report) => void reports.push(report),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    await flushBackground()
    expect(reports.map(({ operation }) => operation)).toEqual(["get", "set"])
  })

  test("ignores cache eviction when the store has no delete operation", async () => {
    const reports: DecisionCacheErrorReport[] = []
    const gate = buildGate({
      cache: {
        get: () => Promise.resolve({ type: "variant", variant: "stale" }),
        set: () => Promise.resolve(),
      },
      decide: () => ({ type: "variant", variant: "dark" }),
      identify: () => ({ distinctId: "user123" }),
      onCacheError: (report) => void reports.push(report),
    })

    expect(await gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })()).toBe(
      "dark"
    )
    await flushBackground()

    expect(reports.map(({ operation }) => operation)).toEqual(["validate"])
  })

  test("detaches immediately when subscription setup invalidates the last cache key", async () => {
    const detach = mock(() => null)
    const gate = buildGate({
      cache: {
        delete: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
      subscribe: (listener) => {
        listener({ keys: ["beta-access"] })
        return detach
      },
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
  })

  test("reports delete failures without failing invalidation", async () => {
    const reports: DecisionCacheErrorReport[] = []
    let notify!: (change: { keys?: readonly string[] }) => void
    const gate = buildGate({
      cache: {
        delete: () => Promise.reject(new Error("delete failed")),
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
      onCacheError: (report) => void reports.push(report),
      subscribe: (listener) => {
        notify = listener
        return () => void notify
      },
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    notify({ keys: ["beta-access"] })
    await flushBackground()
    expect(reports.map(({ operation }) => operation)).toContain("delete")
  })

  test("invalidates only notified flags and supports keyless invalidation", async () => {
    let notify!: (change: { keys?: readonly string[] }) => void
    const removed: string[] = []
    const store = {
      delete: (key: string) => {
        removed.push(key)
        return Promise.resolve(true)
      },
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
    }
    const gate = buildGate({
      cache: store,
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
      subscribe: (listener) => {
        notify = listener
        return () => void notify
      },
    })
    const first = gate({ defaultValue: false, key: "first" })
    const second = gate({ defaultValue: false, key: "second" })

    await first()
    await second()
    notify({ keys: ["first"] })
    await flushBackground()
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain("first")

    notify({})
    await flushBackground()
    expect(removed).toHaveLength(2)
    expect(removed[1]).toContain("second")
  })

  test("does not write a provider decision after its flag is invalidated", async () => {
    const provider = createDeferred<Decision>()
    const providerStarted = createDeferred<boolean>()
    const set = mock(() => Promise.resolve())
    const decide = mock(() => {
      providerStarted.resolve(true)
      return provider.promise
    })
    let notify!: (change: { keys?: readonly string[] }) => void
    const gate = buildGate({
      cache: {
        delete: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        set,
      },
      decide,
      identify: () => ({ distinctId: "user123" }),
      subscribe: (listener) => {
        notify = listener
        return () => void notify
      },
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    const evaluation = evaluator()
    await providerStarted.promise
    notify({ keys: ["beta-access"] })
    provider.resolve({ type: "boolean", value: true })

    expect(await evaluation).toBe(true)
    await flushBackground()
    expect(set).not.toHaveBeenCalled()

    expect(await evaluator()).toBe(true)
    await flushBackground()
    expect(decide).toHaveBeenCalledTimes(2)
    expect(set).toHaveBeenCalledTimes(1)
  })

  test("does not read or write the cache for an anonymous identity", async () => {
    const get = mock(() => Promise.resolve<Decision | null>(null))
    const set = mock(() => Promise.resolve())
    const gate = buildGate({
      anonymous: "allow",
      cache: { get, set },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => null,
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    await flushBackground()
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  test("aborts while cache.get is pending", async () => {
    const pending = createDeferred<Decision | undefined>()
    const controller = new AbortController()
    const reason = new Error("caller stopped")
    const gate = buildGate({
      cache: { get: () => pending.promise, set: () => Promise.resolve() },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluation = gate({ defaultValue: false, key: "beta-access" }).details({
      signal: controller.signal,
    })

    await Bun.sleep(0)
    controller.abort(reason)
    expect(await evaluation).toEqual({
      error: reason,
      flagKey: "beta-access",
      source: "default",
      value: false,
    })
  })

  test("writes only once for a coalesced provider leader", async () => {
    const set = mock(() => Promise.resolve())
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const gate = buildGate({
      cache: { get: () => Promise.resolve(null), set },
      coalesce: true,
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    expect(await Promise.all([evaluator(), evaluator()])).toEqual([true, true])
    await flushBackground()
    expect(decide).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledTimes(1)
  })

  test("does not wait for a cache write", async () => {
    const write = createDeferred<null>()
    const gate = buildGate({
      cache: { get: () => Promise.resolve(null), set: async () => void (await write.promise) },
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
    })

    expect(await gate({ defaultValue: false, key: "beta-access" })()).toBe(true)
    write.resolve(null)
  })
})

describe("request coalescing", () => {
  test("shares concurrent provider work for one evaluation key", async () => {
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const gate = buildGate({
      coalesce: true,
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    expect(await Promise.all([evaluator(), evaluator(), evaluator()])).toEqual([true, true, true])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  test("does not share provider work across factories built from one config object", async () => {
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const config = {
      coalesce: true,
      decide,
      identify: () => ({ distinctId: "user123" }),
    }
    const first = buildGate(config)({ defaultValue: false, key: "beta-access" })
    const second = buildGate(config)({ defaultValue: false, key: "beta-access" })

    expect(await Promise.all([first(), second()])).toEqual([true, true])
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("does not share provider work across incompatible gate shapes", async () => {
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const gate = buildGate({
      coalesce: true,
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const booleanGate = gate({ defaultValue: false, key: "shared" })
    const variantGate = gate({ defaultValue: "a", key: "shared", variants: ["a", "b"] })

    await Promise.all([booleanGate(), variantGate()])
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("supports an identity-sensitive coalescing key", async () => {
    const decide = mock(async () => {
      await Bun.sleep(5)
      return { type: "boolean", value: true } as const
    })
    const gate = buildGate<{ distinctId: string; tenant: string }>({
      coalesce: true,
      decide,
      evaluationKey: (context) => `${context.identity?.tenant}:${context.flagKey}`,
      identify: () => ({ distinctId: "user123", tenant: "unused" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })

    await Promise.all([
      evaluator({ identity: { distinctId: "user123", tenant: "first" } }),
      evaluator({ identity: { distinctId: "user123", tenant: "second" } }),
    ])
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("does not cancel the leader when a follower aborts", async () => {
    const provider = createDeferred<Decision>()
    const controller = new AbortController()
    const gate = buildGate({
      coalesce: true,
      decide: () => provider.promise,
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })
    const leader = evaluator()
    await Bun.sleep(0)
    const follower = evaluator.details({ signal: controller.signal })
    await Bun.sleep(0)

    controller.abort(new Error("follower stopped"))
    provider.resolve({ type: "boolean", value: true })

    expect(await leader).toBe(true)
    const followerDetails = await follower
    expect(followerDetails.source).toBe("default")
    expect(followerDetails.error?.message).toBe("follower stopped")
  })

  test("rejects every follower with the normalized leader failure and permits a retry", async () => {
    const provider = createDeferred<Decision>()
    const decide = mock(() => provider.promise)
    const gate = buildGate({
      coalesce: true,
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const evaluator = gate({ defaultValue: false, key: "beta-access" })
    const evaluations = [evaluator.details(), evaluator.details(), evaluator.details()]
    await Bun.sleep(0)

    provider.reject({ code: "unavailable" } as never)

    const details = await Promise.all(evaluations)
    expect(decide).toHaveBeenCalledTimes(1)
    expect(details.map((result) => result.source)).toEqual(["default", "default", "default"])
    expect(details.map((result) => result.error?.message)).toEqual([
      '{"code":"unavailable"}',
      '{"code":"unavailable"}',
      '{"code":"unavailable"}',
    ])

    decide.mockImplementation(() => Promise.resolve({ type: "boolean", value: true }))
    expect(await evaluator()).toBe(true)
    expect(decide).toHaveBeenCalledTimes(2)
  })
})

describe("timeouts and fallback", () => {
  test("returns the default and reports a timeout", async () => {
    const gate = buildGate({
      decide: () =>
        new Promise<Decision>((_resolve) => {
          void _resolve
        }),
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 5,
    })

    const details = await gate({ defaultValue: false, key: "beta-access" }).details()
    expect(details.source).toBe("default")
    expect(details.error).toBeInstanceOf(GateTimeoutError)
  })
})
