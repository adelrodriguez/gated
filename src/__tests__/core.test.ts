import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, Identity } from "../lib/types"
import { buildGate } from "../core"

describe("buildGate", () => {
  test("creates a gate factory function", () => {
    const gate = buildGate({
      decide: () => Promise.resolve({ value: true }),
      identify: () => Promise.resolve({ distinctId: "user123" }),
    })

    expect(typeof gate).toBe("function")
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
      Promise.resolve({
        value: identity.distinctId === "override",
      })
    )

    const gate = buildGate({
      decide: decideFn,
      identify: identifyFn,
    })

    const betaFlag = gate({ defaultValue: false, key: "beta-access" })
    const result = await betaFlag(overrideIdentity)

    expect(result).toBe(true)
    expect(identifyFn).not.toHaveBeenCalled()
    expect(decideFn).toHaveBeenCalledWith("beta-access", overrideIdentity)
  })

  test("passes hooks to gate execution", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })
    const afterFn = mock(() => {
      // Hook function
    })

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
      decide: (key: string) => Promise.resolve({ value: key === "flag1" }),
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
      decide: (_key, identity) =>
        Promise.resolve({
          value: identity.plan === "pro",
        }),
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
    const errorFn = mock(() => {
      // Hook function
    })

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
        flagKey: "beta-access",
        identity: { distinctId: "user123" },
      },
      error
    )
  })

  test("finally hooks always run", async () => {
    const finallyFn = mock(() => {
      // Hook function
    })

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
    const finallyFn = mock(() => {
      // Hook function
    })

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

    expect(decideFn).toHaveBeenCalledWith("flag1", { distinctId: "user123" })
    expect(decideFn).toHaveBeenCalledWith("flag2", { distinctId: "user123" })
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
      Promise.resolve({
        value: identity.role === "admin",
      })
    )

    const gate = buildGate<CustomIdentity>({
      decide: decideFn,
      identify: () => Promise.resolve(customIdentity),
    })

    const adminFlag = gate({ defaultValue: false, key: "admin-feature" })
    const result = await adminFlag()

    expect(result).toBe(true)
    expect(decideFn).toHaveBeenCalledWith("admin-feature", customIdentity)
  })
})
