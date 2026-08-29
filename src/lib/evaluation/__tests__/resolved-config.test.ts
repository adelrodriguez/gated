import { describe, expect, test, vi } from "vitest"
import type { Decision, Hook, Identity } from "../../types"
import { IdentityNotFoundError } from "../../errors"
import { resolveConfig } from "../resolved-config"

const decision: Decision = { type: "boolean", value: true }
const signal = new AbortController().signal

async function captureRejection<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected promise to reject")
}

async function expectIdentityNotFound<T>(promise: Promise<T>) {
  expect(await captureRejection(promise)).toBeInstanceOf(IdentityNotFoundError)
}

describe("resolveIdentity", () => {
  describe("strict config", () => {
    test("returns the override without identifying", async () => {
      const identify = vi.fn(() => Promise.resolve<Identity>({ distinctId: "default" }))
      const resolved = resolveConfig({ decide: () => decision, identify })
      const override: Identity = { distinctId: "override" }

      expect(await resolved.resolveIdentity(override)).toEqual(override)
      expect(identify).not.toHaveBeenCalled()
    })

    test("rejects a null override without identifying", async () => {
      const identify = vi.fn(() => Promise.resolve<Identity>({ distinctId: "default" }))
      const resolved = resolveConfig({ decide: () => decision, identify })

      await expectIdentityNotFound(resolved.resolveIdentity(null))
      expect(identify).not.toHaveBeenCalled()
    })

    test("identifies when no override is provided", async () => {
      const identity: Identity = { distinctId: "user123" }
      const identify = vi.fn(() => Promise.resolve(identity))
      const resolved = resolveConfig({ decide: () => decision, identify })

      expect(await resolved.resolveIdentity()).toEqual(identity)
      expect(identify).toHaveBeenCalledTimes(1)
    })

    test("handles a synchronous identify function", async () => {
      const identity: Identity = { distinctId: "user123" }
      const resolved = resolveConfig({ decide: () => decision, identify: () => identity })

      expect(await resolved.resolveIdentity()).toEqual(identity)
    })

    test("preserves custom identity properties", async () => {
      interface CustomIdentity extends Identity {
        email: string
        plan: "free" | "pro"
      }

      const identity: CustomIdentity = {
        distinctId: "user123",
        email: "user@example.com",
        plan: "pro",
      }
      const resolved = resolveConfig<CustomIdentity>({
        decide: () => decision,
        identify: () => Promise.resolve(identity),
      })

      expect(await resolved.resolveIdentity()).toEqual(identity)
    })

    test("rejects when identify returns null", async () => {
      const resolved = resolveConfig({ decide: () => decision, identify: () => null })

      await expectIdentityNotFound(resolved.resolveIdentity())
    })

    test("propagates an identify failure", async () => {
      const failure = new Error("Identity error")
      const resolved = resolveConfig({
        decide: () => decision,
        identify: () => Promise.reject(failure),
      })

      expect(await captureRejection(resolved.resolveIdentity())).toBe(failure)
    })
  })

  describe("anonymous config", () => {
    test("returns the override without identifying", async () => {
      const identify = vi.fn(() => Promise.resolve<Identity>({ distinctId: "default" }))
      const resolved = resolveConfig({ anonymous: "allow", decide: () => decision, identify })
      const override: Identity = { distinctId: "override" }

      expect(await resolved.resolveIdentity(override)).toEqual(override)
      expect(identify).not.toHaveBeenCalled()
    })

    test("accepts a null override", async () => {
      const identify = vi.fn(() => Promise.resolve<Identity>({ distinctId: "default" }))
      const resolved = resolveConfig({ anonymous: "allow", decide: () => decision, identify })

      expect(await resolved.resolveIdentity(null)).toBeNull()
      expect(identify).not.toHaveBeenCalled()
    })

    test("identifies when no override is provided", async () => {
      const identity: Identity = { distinctId: "user123" }
      const resolved = resolveConfig({
        anonymous: "allow",
        decide: () => decision,
        identify: () => Promise.resolve(identity),
      })

      expect(await resolved.resolveIdentity()).toEqual(identity)
    })

    test("resolves to null when identify returns null", async () => {
      const resolved = resolveConfig({
        anonymous: "allow",
        decide: () => decision,
        identify: () => null,
      })

      expect(await resolved.resolveIdentity()).toBeNull()
    })

    test("normalizes an undefined identify result to null", async () => {
      const identify = vi.fn(() => void 0)
      const resolved = resolveConfig({
        anonymous: "allow",
        decide: () => decision,
        identify: identify as unknown as () => Identity | null,
      })

      expect(await resolved.resolveIdentity()).toBeNull()
    })

    test("propagates an identify failure", async () => {
      const failure = new Error("Identity error")
      const resolved = resolveConfig({
        anonymous: "allow",
        decide: () => decision,
        identify: () => Promise.reject(failure),
      })

      expect(await captureRejection(resolved.resolveIdentity())).toBe(failure)
    })
  })

  describe("caller-identity config", () => {
    test("returns the override", async () => {
      const resolved = resolveConfig({ decide: () => decision })
      const override: Identity = { distinctId: "caller" }

      expect(await resolved.resolveIdentity(override)).toEqual(override)
    })

    test("rejects a null override", async () => {
      const resolved = resolveConfig({ decide: () => decision })

      await expectIdentityNotFound(resolved.resolveIdentity(null))
    })

    test("rejects a missing override", async () => {
      const resolved = resolveConfig({ decide: () => decision })

      await expectIdentityNotFound(resolved.resolveIdentity())
    })
  })
})

describe("decide", () => {
  test("forwards the identity and signal to the configured decide", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decide = vi.fn(() => Promise.resolve(decision))
    const resolved = resolveConfig({ decide, identify: () => identity })

    expect(await resolved.decide("beta-access", identity, { signal })).toEqual(decision)
    expect(decide).toHaveBeenCalledWith("beta-access", identity, { signal })
  })

  test("rejects a null identity for a strict config without calling decide", async () => {
    const decide = vi.fn(() => Promise.resolve(decision))
    const resolved = resolveConfig({ decide, identify: () => ({ distinctId: "user123" }) })

    await expectIdentityNotFound(resolved.decide("beta-access", null, { signal }))
    expect(decide).not.toHaveBeenCalled()
  })

  test("passes a null identity through for an anonymous config", async () => {
    const decide = vi.fn(() => Promise.resolve(decision))
    const resolved = resolveConfig({
      anonymous: "allow",
      decide,
      identify: () => null,
    })

    expect(await resolved.decide("beta-access", null, { signal })).toEqual(decision)
    expect(decide).toHaveBeenCalledWith("beta-access", null, { signal })
  })
})

describe("decideMany", () => {
  test("is absent when the config does not provide it", () => {
    const resolved = resolveConfig({
      decide: () => decision,
      identify: () => ({ distinctId: "user123" }),
    })

    expect(resolved.decideMany).toBeUndefined()
  })

  test("forwards the keys and identity to the configured decideMany", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decisions = { "beta-access": decision }
    const decideMany = vi.fn(() => Promise.resolve(decisions))
    const resolved = resolveConfig({
      decide: () => decision,
      decideMany,
      identify: () => identity,
    })

    expect(await resolved.decideMany?.(["beta-access"], identity, { signal })).toEqual(decisions)
    expect(decideMany).toHaveBeenCalledWith(["beta-access"], identity, { signal })
  })

  test("rejects a null identity for a strict config without calling decideMany", async () => {
    const decideMany = vi.fn(() => Promise.resolve({}))
    const resolved = resolveConfig({
      decide: () => decision,
      decideMany,
      identify: () => ({ distinctId: "user123" }),
    })

    await expectIdentityNotFound(
      resolved.decideMany?.(["beta-access"], null, { signal }) ?? Promise.resolve({})
    )
    expect(decideMany).not.toHaveBeenCalled()
  })

  test("passes a null identity through for an anonymous config", async () => {
    const decisions = { "beta-access": decision }
    const decideMany = vi.fn(() => Promise.resolve(decisions))
    const resolved = resolveConfig({
      anonymous: "allow",
      decide: () => decision,
      decideMany,
      identify: () => null,
    })

    expect(await resolved.decideMany?.(["beta-access"], null, { signal })).toEqual(decisions)
  })
})

describe("resolved fields", () => {
  test("coalescing is on by default and off when disabled", () => {
    const config = { decide: () => decision, identify: () => ({ distinctId: "user123" }) }

    expect(resolveConfig(config).coalesce).toBe(true)
    expect(resolveConfig({ ...config, coalesce: true }).coalesce).toBe(true)
    expect(resolveConfig({ ...config, coalesce: false }).coalesce).toBe(false)
  })

  test("snapshots hooks at resolution", () => {
    const hooks: Hook[] = [{ before: () => void 0 }]
    const resolved = resolveConfig({
      decide: () => decision,
      hooks,
      identify: () => ({ distinctId: "user123" }),
    })

    hooks.push({ before: () => void 0 })

    expect(resolved.hooks).toHaveLength(1)
  })

  test("creates isolated resolution state per call", () => {
    const config = { decide: () => decision, identify: () => ({ distinctId: "user123" }) }

    const first = resolveConfig(config)
    const second = resolveConfig(config)

    expect(first.state).not.toBe(second.state)
  })
})
