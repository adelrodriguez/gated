import { describe, expect, mock, test } from "bun:test"
import type { Decision, EvaluationDetails, Hook, Identity } from "../lib/types"
import { buildGate } from "../core"

describe("buildGate", () => {
  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2_147_483_648])(
    "rejects an invalid factory timeout of %p",
    (timeoutMs) => {
      expect(() =>
        buildGate({
          decide: () => ({ value: true }),
          identify: () => ({ distinctId: "user123" }),
          timeoutMs,
        })
      ).toThrow(RangeError)
    }
  )

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2_147_483_648])(
    "rejects an invalid per-gate timeout of %p",
    (timeoutMs) => {
      const gate = buildGate({
        decide: () => ({ value: true }),
        identify: () => ({ distinctId: "user123" }),
      })

      expect(() => gate({ defaultValue: false, key: "beta-access", timeoutMs })).toThrow(RangeError)
    }
  )

  test("creates a gate factory function", () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    expect(typeof gate).toBe("function")
  })

  test("accepts synchronous identify and decide functions", async () => {
    const gate = buildGate({
      decide: (_key, identity) => ({ value: identity.distinctId === "user123" }),
      identify: () => ({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag()).toBe(true)
  })

  test("creates boolean flag that evaluates to true", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { value: true }

    const gate = buildGate({
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(identity)),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("returns provider evaluation details without changing the plain value", async () => {
    const gate = buildGate({
      decide: () => ({ value: true }),
      identify: () => ({ distinctId: "user123" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag.details()).toEqual({
      flagKey: "beta-access",
      source: "provider",
      value: true,
    })
    expect(await betaFlag()).toBe(true)
  })

  test("returns hook evaluation details", async () => {
    const gate = buildGate({
      decide: () => ({ value: false }),
      hooks: [{ resolve: () => ({ value: true }) }],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag.details()).toEqual({
      flagKey: "beta-access",
      source: "hook",
      value: true,
    })
  })

  test("returns the provider error with default evaluation details", async () => {
    const error = new Error("Provider unavailable")
    const gate = buildGate({
      decide: () => Promise.reject(error),
      identify: () => ({ distinctId: "user123" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag.details()).toEqual({
      error,
      flagKey: "beta-access",
      source: "default",
      value: false,
    })
  })

  test("normalizes undefined rejections without hiding the failure", async () => {
    const gate = buildGate({
      // oxlint-disable-next-line eslint/arrow-body-style -- Keep the intentional invalid rejection localized.
      decide: () => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercise hostile JavaScript callers.
        return Promise.reject<Decision>()
      },
      identify: () => ({ distinctId: "user123" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag()).toBe(false)

    const details = await betaFlag.details()
    expect(details.source).toBe("default")
    if (details.source === "default") {
      expect(details.error).toBeInstanceOf(Error)
      expect(details.error.message).toBe("undefined")
    }
  })

  test("never rejects when error inspection throws", async () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const gate = buildGate({
      decide: () => {
        // oxlint-disable-next-line typescript/only-throw-error -- Exercise hostile JavaScript callers.
        throw proxy
      },
      identify: () => ({ distinctId: "user123" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag()).toBe(false)

    const details = await betaFlag.details()
    expect(details.source).toBe("default")
    if (details.source === "default") {
      expect(details.error).toBeInstanceOf(Error)
      expect(details.error.message).toBe("Uninspectable value thrown")
    }
  })

  test("returns the identity error with default evaluation details", async () => {
    const gate = buildGate({
      decide: () => ({ value: true }),
      identify: () => null,
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const details = await betaFlag.details()

    expect(details).toEqual({
      error: expect.any(Error),
      flagKey: "beta-access",
      source: "default",
      value: false,
    })
    expect(details.error).toHaveProperty("message", "Identity not found")
  })

  test("details accepts an override identity", async () => {
    const identify = mock(() => ({ distinctId: "default" }))
    const overrideIdentity = { distinctId: "override" }
    const gate = buildGate({
      decide: (_key, identity) => ({ value: identity.distinctId === "override" }),
      identify,
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    expect(await betaFlag.details({ identity: overrideIdentity })).toEqual({
      flagKey: "beta-access",
      source: "provider",
      value: true,
    })
    expect(identify).not.toHaveBeenCalled()
  })

  test("preserves variant value inference in evaluation details", async () => {
    const gate = buildGate({
      decide: () => ({ variant: "dark" }),
      identify: () => ({ distinctId: "user123" }),
    })
    const themeFlag = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark", "system"],
    })

    const details: EvaluationDetails<"light" | "dark" | "system"> = await themeFlag.details()

    expect(details).toEqual({ flagKey: "theme", source: "provider", value: "dark" })
  })

  test("creates boolean flag that evaluates to false", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { value: false }

    const gate = buildGate({
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(identity)),
    })

    const betaFlag = gate({ defaultValue: true, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("creates variant flag with string variants", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { variant: "dark" }

    const gate = buildGate({
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(identity)),
    })

    const themeFlag = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark", "system"],
    })

    const result = await themeFlag()

    expect(result).toBe("dark")
  })

  test("returns default value when identity not found", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve(null),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("returns default value when decide throws error", async () => {
    const gate = buildGate({
      decide: () => Promise.reject(new Error("Provider error")),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("uses override identity when provided", async () => {
    const defaultIdentity: Identity = { distinctId: "default" }
    const overrideIdentity: Identity = { distinctId: "override" }

    const identifyFn = mock(() => Promise.resolve(defaultIdentity))
    const decideFn = mock((_key: string, identity: Identity) =>
      Promise.resolve({ value: identity.distinctId === "override" })
    )

    const gate = buildGate({
      decide: decideFn,
      identify: identifyFn,
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag({ identity: overrideIdentity })

    expect(result).toBe(true)
    expect(identifyFn).not.toHaveBeenCalled()
    expect(decideFn).toHaveBeenCalledWith(
      "beta-access",
      overrideIdentity,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  test("rejects the legacy bare-identity call shape", async () => {
    const gate = buildGate({
      decide: () => Promise.reject(new Error("unreachable")),
      identify: () => ({ distinctId: "default" }),
    })
    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    const evaluationError = await betaFlag({ distinctId: "legacy" } as never).catch(
      (error: unknown) => error
    )
    const detailsError = await betaFlag
      .details({ distinctId: "legacy" } as never)
      .catch((error: unknown) => error)

    expect(evaluationError).toBeInstanceOf(TypeError)
    expect(evaluationError).toHaveProperty(
      "message",
      "Gate evaluators now accept an options object; pass the identity as { identity }."
    )
    expect(detailsError).toBeInstanceOf(TypeError)
  })

  test("passes hooks to gate execution", async () => {
    const beforeFn = mock(() => Promise.resolve())
    const afterFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ after: afterFn, before: beforeFn }]

    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      hooks,
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    await betaFlag()

    expect(beforeFn).toHaveBeenCalled()
    expect(afterFn).toHaveBeenCalled()
  })

  test("hook can short-circuit evaluation", async () => {
    const cachedDecision: Decision = { value: true }
    const resolveFn = mock(() => Promise.resolve(cachedDecision))

    const hooks: Hook[] = [{ resolve: resolveFn }]

    const decideFn = mock(() => Promise.resolve({ value: false }))

    const gate = buildGate({
      decide: decideFn,
      hooks,
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
    expect(decideFn).not.toHaveBeenCalled() // Short-circuited
  })

  test("multiple flags from same gate", async () => {
    const gate = buildGate({
      decide: (key) => Promise.resolve({ value: key === "flag1" }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const flag1 = gate({ defaultValue: false, key: "flag1" })
    const flag2 = gate({ defaultValue: false, key: "flag2" })

    const result1 = await flag1()
    const result2 = await flag2()

    expect(result1).toBe(true)
    expect(result2).toBe(false)
  })

  test("validates variant decision against variants list", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ variant: "invalid" }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const themeFlag = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const result = await themeFlag()

    // Should return default when validation fails
    expect(result).toBe("light")
  })

  test("accepts valid variant from variants list", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ variant: "dark" }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const themeFlag = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark", "system"],
    })

    const result = await themeFlag()

    expect(result).toBe("dark")
  })

  test("works with custom identity type", async () => {
    interface CustomIdentity extends Identity {
      email: string
      plan: "free" | "pro"
    }

    const customIdentity: CustomIdentity = {
      distinctId: "user123",
      email: "user@example.com",
      plan: "pro",
    }

    const gate = buildGate<CustomIdentity>({
      decide: (_key, identity) => Promise.resolve({ value: identity.plan === "pro" }),
      identify: () => Promise.resolve(customIdentity),
    })

    const proFlag = gate({ defaultValue: false, key: "pro-feature" })
    const result = await proFlag()

    expect(result).toBe(true)
  })

  test("handles identify function that returns Promise", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("handles decide function that returns Promise", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("error hooks are called on failure", async () => {
    const error = new Error("Test error")
    const errorFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn }]

    const gate = buildGate({
      decide: () => Promise.reject(error),
      hooks,
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    await betaFlag()

    expect(errorFn).toHaveBeenCalledWith(
      {
        defaultValue: false,
        flagKey: "beta-access",
        identity: { distinctId: "user123" },
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      },
      error
    )
  })

  test("finally hooks always run", async () => {
    const finallyFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ finally: finallyFn }]

    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      hooks,
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    await betaFlag()

    expect(finallyFn).toHaveBeenCalled()
  })

  test("finally hooks run even on error", async () => {
    const finallyFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ finally: finallyFn }]

    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      hooks,
      identify: () => Promise.reject(new Error("Identity error")),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    await betaFlag()

    expect(finallyFn).toHaveBeenCalled()
  })

  test("works without hooks configuration", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("works with empty hooks array", async () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      hooks: [],
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("flag function can be called multiple times", async () => {
    let callCount = 0
    const gate = buildGate({
      decide: () => {
        callCount += 1
        return Promise.resolve({ value: true })
      },
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })

    await betaFlag()
    await betaFlag()
    await betaFlag()

    expect(callCount).toBe(3)
  })

  test("different flags are independent", async () => {
    const identifyFn = mock(() => Promise.resolve({ distinctId: "user123" }))
    const decideFn = mock((_key: string) => Promise.resolve({ value: true }))

    const gate = buildGate({
      decide: decideFn,
      identify: identifyFn,
    })

    const flag1 = gate({ defaultValue: false, key: "flag1" })
    const flag2 = gate({ defaultValue: false, key: "flag2" })

    await flag1()
    await flag2()

    expect(decideFn).toHaveBeenCalledWith("flag1", { distinctId: "user123" }, expect.any(Object))
    expect(decideFn).toHaveBeenCalledWith("flag2", { distinctId: "user123" }, expect.any(Object))
  })

  test("handles numeric distinctId", async () => {
    const identity: Identity = { distinctId: 12_345 }

    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve(identity),
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("preserves additional identity properties", async () => {
    interface CustomIdentity extends Identity {
      email: string
      role: string
    }

    const customIdentity: CustomIdentity = {
      distinctId: "user123",
      email: "user@example.com",
      role: "admin",
    }

    const decideFn = mock((_key: string, identity: CustomIdentity) =>
      Promise.resolve({ value: identity.role === "admin" })
    )

    const gate = buildGate<CustomIdentity>({
      decide: decideFn,
      identify: () => Promise.resolve(customIdentity),
    })

    const adminFlag = gate({ defaultValue: false, key: "admin-feature" })
    const result = await adminFlag()

    expect(result).toBe(true)
    expect(decideFn).toHaveBeenCalledWith("admin-feature", customIdentity, expect.any(Object))
  })
})
