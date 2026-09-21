import { setTimeout as sleep } from "node:timers/promises"
import { describe, expect, test, vi } from "vitest"
import type { Decision, HookContext, Identity } from "../../types"
import type { AnyGatedConfig } from "../shared"
import { resolveDecision } from "../resolve"
import { resolveConfig, type ResolvedConfig } from "../resolved-config"

const trueDecision: Decision = { type: "boolean", value: true }
const falseDecision: Decision = { type: "boolean", value: false }

const options = { defaultValue: false, key: "beta-access" }

function createContext(): HookContext {
  return {
    defaultValue: false,
    flagKey: "beta-access",
    identity: { distinctId: "user123" },
    kind: "boolean",
    signal: new AbortController().signal,
    variants: undefined,
  }
}

function createConfig(overrides: Partial<AnyGatedConfig<Identity>> = {}): ResolvedConfig<Identity> {
  return resolveConfig({
    decide: () => trueDecision,
    identify: () => ({ distinctId: "user123" }),
    ...overrides,
  })
}

async function expectRejection(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toHaveProperty("message", message)
    return
  }
  throw new Error("Expected the resolution to reject")
}

describe("resolveDecision", () => {
  test("shares the leader decision with followers and empties pending after settle", async () => {
    const config = createConfig()
    const { state } = config
    const context = createContext()
    const request = Promise.withResolvers<Decision>()
    const provider = vi.fn(() => request.promise)
    const signal = new AbortController().signal

    const leader = resolveDecision(config, context, options, provider, signal)
    const follower = resolveDecision(config, context, options, provider, signal)
    expect(state.pending.size).toBe(1)
    request.resolve(trueDecision)

    const results = await Promise.all([leader, follower])
    expect(results.map((result) => result.decision)).toEqual([trueDecision, trueDecision])
    expect(provider).toHaveBeenCalledTimes(1)
    expect(state.pending.size).toBe(0)
  })

  test("rejects followers with the leader error and empties pending", async () => {
    const config = createConfig()
    const { state } = config
    const context = createContext()
    const request = Promise.withResolvers<Decision>()
    const provider = vi.fn(() => request.promise)
    const signal = new AbortController().signal

    const leader = expectRejection(
      resolveDecision(config, context, options, provider, signal),
      "Provider failed"
    )
    const follower = expectRejection(
      resolveDecision(config, context, options, provider, signal),
      "Provider failed"
    )
    await sleep(0)
    request.reject(new Error("Provider failed"))

    await Promise.all([leader, follower])
    expect(provider).toHaveBeenCalledTimes(1)
    expect(state.pending.size).toBe(0)
  })

  test("keeps a follower abort independent from the leader", async () => {
    const config = createConfig()
    const { state } = config
    const context = createContext()
    const request = Promise.withResolvers<Decision>()
    const provider = vi.fn(() => request.promise)
    const abortedController = new AbortController()
    abortedController.abort(new Error("Follower aborted"))

    const leader = resolveDecision(config, context, options, provider, new AbortController().signal)
    const follower = resolveDecision(config, context, options, provider, abortedController.signal)

    await expectRejection(follower, "Follower aborted")
    request.resolve(trueDecision)
    const leaderResolution = await leader
    expect(leaderResolution.decision).toEqual(trueDecision)
    expect(provider).toHaveBeenCalledTimes(1)
    expect(state.pending.size).toBe(0)
  })

  test("does not remove a newer leader when a replaced leader settles", async () => {
    let notify: ((change: { keys?: readonly string[] }) => void) | undefined
    const config = createConfig({
      subscribe: (listener) => {
        notify = listener
        return () => null
      },
    })
    const { state } = config
    const context = createContext()
    const firstRequest = Promise.withResolvers<Decision>()
    const secondRequest = Promise.withResolvers<Decision>()

    const firstLeader = resolveDecision(
      config,
      context,
      options,
      () => firstRequest.promise,
      new AbortController().signal
    )
    notify?.({ keys: ["beta-access"] })
    expect(state.pending.size).toBe(0)

    const secondLeader = resolveDecision(
      config,
      context,
      options,
      () => secondRequest.promise,
      new AbortController().signal
    )
    expect(state.pending.size).toBe(1)

    firstRequest.resolve(trueDecision)
    await firstLeader
    expect(state.pending.size).toBe(1)

    secondRequest.resolve(falseDecision)
    const secondResolution = await secondLeader
    expect(secondResolution.decision).toEqual(falseDecision)
    expect(state.pending.size).toBe(0)
  })

  test("skips a cache write when invalidation advances after the read", async () => {
    const set = vi.fn(() => Promise.resolve())
    let notify: ((change: { keys?: readonly string[] }) => void) | undefined
    const config = createConfig({
      cache: {
        delete: () => Promise.resolve(true),
        get: () => Promise.resolve(null),
        set,
      },
      subscribe: (listener) => {
        notify = listener
        return () => null
      },
    })
    const context = createContext()
    const request = Promise.withResolvers<Decision>()

    const resolution = resolveDecision(
      config,
      context,
      options,
      () => request.promise,
      new AbortController().signal
    )
    await sleep(0)
    notify?.({ keys: ["beta-access"] })
    request.resolve(trueDecision)

    const settled = await resolution
    expect(settled.source).toBe("provider")
    await sleep(0)
    expect(set).not.toHaveBeenCalled()
  })
})
