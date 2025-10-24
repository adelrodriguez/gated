import { describe, expect, mock, test } from "bun:test"
import { buildGate } from "../core"
import type { Decision, Hook, Identity } from "../lib/types"

describe("buildGate", () => {
  test("creates a gate factory function", () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
    })

    expect(typeof gate).toBe("function")
  })

  test("creates boolean flag that evaluates to true", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { value: true }

    const gate = buildGate({
      identify: mock(async () => identity),
      decide: mock(async () => decision),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("creates boolean flag that evaluates to false", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { value: false }

    const gate = buildGate({
      identify: mock(async () => identity),
      decide: mock(async () => decision),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: true })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("creates variant flag with string variants", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { variant: "dark" }

    const gate = buildGate({
      identify: mock(async () => identity),
      decide: mock(async () => decision),
    })

    const themeFlag = gate({
      key: "theme",
      defaultValue: "light",
      variants: ["light", "dark", "system"],
    })

    const result = await themeFlag()

    expect(result).toBe("dark")
  })

  test("returns default value when identity not found", async () => {
    const gate = buildGate({
      identify: async () => null,
      decide: async () => ({ value: true }),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("returns default value when decide throws error", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      // biome-ignore lint/suspicious/useAwait: Mock must be async to match type signature
      decide: async () => {
        throw new Error("Provider error")
      },
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(false)
  })

  test("uses override identity when provided", async () => {
    const defaultIdentity: Identity = { distinctId: "default" }
    const overrideIdentity: Identity = { distinctId: "override" }

    const identifyFn = mock(async () => defaultIdentity)
    const decideFn = mock(async (_key: string, identity: Identity) => ({
      value: identity.distinctId === "override",
    }))

    const gate = buildGate({
      identify: identifyFn,
      decide: decideFn,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag(overrideIdentity)

    expect(result).toBe(true)
    expect(identifyFn).not.toHaveBeenCalled()
    expect(decideFn).toHaveBeenCalledWith("beta-access", overrideIdentity)
  })

  test("passes hooks to gate execution", async () => {
    const beforeFn = mock(async () => {
      // Hook function
    })
    const afterFn = mock(async () => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn, after: afterFn }]

    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
      hooks,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    await betaFlag()

    expect(beforeFn).toHaveBeenCalled()
    expect(afterFn).toHaveBeenCalled()
  })

  test("hook can short-circuit evaluation", async () => {
    const cachedDecision: Decision = { value: true }
    const resolveFn = mock(async () => cachedDecision)

    const hooks: Hook[] = [{ resolve: resolveFn }]

    const decideFn = mock(async () => ({ value: false }))

    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: decideFn,
      hooks,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
    expect(decideFn).not.toHaveBeenCalled() // Short-circuited
  })

  test("multiple flags from same gate", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async (key) => ({ value: key === "flag1" }),
    })

    const flag1 = gate({ key: "flag1", defaultValue: false })
    const flag2 = gate({ key: "flag2", defaultValue: false })

    const result1 = await flag1()
    const result2 = await flag2()

    expect(result1).toBe(true)
    expect(result2).toBe(false)
  })

  test("validates variant decision against variants list", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ variant: "invalid" }),
    })

    const themeFlag = gate({
      key: "theme",
      defaultValue: "light",
      variants: ["light", "dark"],
    })

    const result = await themeFlag()

    // Should return default when validation fails
    expect(result).toBe("light")
  })

  test("accepts valid variant from variants list", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ variant: "dark" }),
    })

    const themeFlag = gate({
      key: "theme",
      defaultValue: "light",
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
      identify: async () => customIdentity,
      decide: async (_key, identity) => ({
        value: identity.plan === "pro",
      }),
    })

    const proFlag = gate({ key: "pro-feature", defaultValue: false })
    const result = await proFlag()

    expect(result).toBe(true)
  })

  test("handles identify function that returns Promise", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("handles decide function that returns Promise", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("error hooks are called on failure", async () => {
    const error = new Error("Test error")
    const errorFn = mock(async () => {
      // Hook function
    })

    const hooks: Hook[] = [{ error: errorFn }]

    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      // biome-ignore lint/suspicious/useAwait: Mock must be async to match type signature
      decide: async () => {
        throw error
      },
      hooks,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    await betaFlag()

    expect(errorFn).toHaveBeenCalledWith(
      {
        flagKey: "beta-access",
        identity: { distinctId: "user123" },
      },
      error
    )
  })

  test("finally hooks always run", async () => {
    const finallyFn = mock(async () => {
      // Hook function
    })

    const hooks: Hook[] = [{ finally: finallyFn }]

    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
      hooks,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    await betaFlag()

    expect(finallyFn).toHaveBeenCalled()
  })

  test("finally hooks run even on error", async () => {
    const finallyFn = mock(async () => {
      // Hook function
    })

    const hooks: Hook[] = [{ finally: finallyFn }]

    const gate = buildGate({
      // biome-ignore lint/suspicious/useAwait: Mock must be async to match type signature
      identify: async () => {
        throw new Error("Identity error")
      },
      decide: async () => ({ value: true }),
      hooks,
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    await betaFlag()

    expect(finallyFn).toHaveBeenCalled()
  })

  test("works without hooks configuration", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("works with empty hooks array", async () => {
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      decide: async () => ({ value: true }),
      hooks: [],
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
    const result = await betaFlag()

    expect(result).toBe(true)
  })

  test("flag function can be called multiple times", async () => {
    let callCount = 0
    const gate = buildGate({
      identify: async () => ({ distinctId: "user123" }),
      // biome-ignore lint/suspicious/useAwait: Increments counter then returns value
      decide: async () => {
        callCount++
        return { value: true }
      },
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })

    await betaFlag()
    await betaFlag()
    await betaFlag()

    expect(callCount).toBe(3)
  })

  test("different flags are independent", async () => {
    const identifyFn = mock(async () => ({ distinctId: "user123" }))
    const decideFn = mock(async (_key: string) => ({ value: true }))

    const gate = buildGate({
      identify: identifyFn,
      decide: decideFn,
    })

    const flag1 = gate({ key: "flag1", defaultValue: false })
    const flag2 = gate({ key: "flag2", defaultValue: false })

    await flag1()
    await flag2()

    expect(decideFn).toHaveBeenCalledWith("flag1", { distinctId: "user123" })
    expect(decideFn).toHaveBeenCalledWith("flag2", { distinctId: "user123" })
  })

  test("handles numeric distinctId", async () => {
    const identity: Identity = { distinctId: 12_345 }

    const gate = buildGate({
      identify: async () => identity,
      decide: async () => ({ value: true }),
    })

    const betaFlag = gate({ key: "beta-access", defaultValue: false })
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

    const decideFn = mock(async (_key: string, identity: CustomIdentity) => ({
      value: identity.role === "admin",
    }))

    const gate = buildGate<CustomIdentity>({
      identify: async () => customIdentity,
      decide: decideFn,
    })

    const adminFlag = gate({ key: "admin-feature", defaultValue: false })
    const result = await adminFlag()

    expect(result).toBe(true)
    expect(decideFn).toHaveBeenCalledWith("admin-feature", customIdentity)
  })
})
