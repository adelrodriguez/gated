import { setTimeout as sleep } from "node:timers/promises"
import { describe, expect, test, vi } from "vitest"
import type { GateCallOptions, Decision, Hook, Identity } from "../../types"
import type { AnyGatedConfig, GateOptions } from "../shared"
import { MalformedDecisionError } from "../../errors"
import { extractDecisionValue, validateDecision } from "../decision"
import { executeGate as executeResolvedGate } from "../engine"
import { resolveConfig } from "../resolved-config"

function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity | null>
): Promise<boolean | T[number]> {
  return executeResolvedGate(resolveConfig(config), options, callOptions)
}

async function expectRejection<T>(promise: Promise<T>, message: string) {
  let caughtError: Error | undefined

  try {
    await promise
  } catch (error) {
    caughtError = error instanceof Error ? error : new Error(String(error))
  }

  expect(caughtError).toBeInstanceOf(Error)
  expect(caughtError).toMatchObject({ message })
  return caughtError
}

describe("extractDecisionValue", () => {
  test("extracts boolean value from boolean decision", () => {
    const decision: Decision = { type: "boolean", value: true }

    const result = extractDecisionValue(decision)

    expect(result).toBe(true)
  })

  test("extracts variant from variant decision", () => {
    const decision: Decision = { type: "variant", variant: "dark" }

    const result = extractDecisionValue(decision)

    expect(result).toBe("dark")
  })

  test("extracts values without validation", () => {
    const booleanDecision: Decision = { type: "boolean", value: true }
    const variantDecision: Decision = { type: "variant", variant: "system" }

    expect(extractDecisionValue(booleanDecision)).toBe(true)
    expect(extractDecisionValue(variantDecision)).toBe("system")
  })
})

describe("validateDecision", () => {
  test("accepts a boolean decision for a boolean gate", () => {
    expect(() => {
      validateDecision(
        { type: "boolean", value: true },
        { defaultValue: false, key: "beta-access" }
      )
    }).not.toThrow()
  })

  test("accepts an allowed variant for a variant gate", () => {
    expect(() => {
      validateDecision(
        { type: "variant", variant: "dark" },
        { defaultValue: "light", key: "theme", variants: ["light", "dark"] }
      )
    }).not.toThrow()
  })

  test("rejects a variant decision for a boolean gate", () => {
    expect(() => {
      validateDecision(
        { type: "variant", variant: "dark" },
        { defaultValue: false, key: "beta-access" }
      )
    }).toThrow('Type mismatch: expected boolean decision but received variant "dark"')
  })

  test("rejects a boolean decision for a variant gate", () => {
    expect(() => {
      validateDecision(
        { type: "boolean", value: true },
        { defaultValue: "light", key: "theme", variants: ["light", "dark"] }
      )
    }).toThrow('Type mismatch: expected variant decision but received boolean "true"')
  })

  test("rejects a variant outside the allowed list", () => {
    expect(() => {
      validateDecision(
        { type: "variant", variant: "purple" },
        { defaultValue: "light", key: "theme", variants: ["light", "dark"] }
      )
    }).toThrow("Invalid variant: purple")
  })

  test("rejects decisions without a valid type discriminant", () => {
    expect(() => {
      validateDecision(
        { value: true },
        {
          defaultValue: false,
          key: "beta-access",
        }
      )
    }).toThrow(MalformedDecisionError)
    expect(() => {
      validateDecision(
        { variant: "dark" },
        {
          defaultValue: "light",
          key: "theme",
          variants: ["light", "dark"],
        }
      )
    }).toThrow(MalformedDecisionError)
  })

  test("rejects decisions whose value does not match the discriminant", () => {
    expect(() => {
      validateDecision(
        { type: "boolean", value: "true" },
        {
          defaultValue: false,
          key: "beta-access",
        }
      )
    }).toThrow(MalformedDecisionError)
    expect(() => {
      validateDecision(
        { type: "variant", variant: 1 },
        {
          defaultValue: "light",
          key: "theme",
          variants: ["light", "dark"],
        }
      )
    }).toThrow(MalformedDecisionError)
  })
})

describe("executeGate", () => {
  test("executes boolean gate successfully", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "boolean", value: true }

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      hooks: [],
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
    expect(config.identify).toHaveBeenCalled()
    expect(config.decide).toHaveBeenCalledWith("test-flag", identity, expect.any(Object))
  })

  test("executes variant gate successfully", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "variant", variant: "dark" }

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      hooks: [],
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark", "system"],
    }

    const result = await executeGate(config, options)

    expect(result).toBe("dark")
  })

  test("uses override identity when provided", async () => {
    const defaultIdentity: Identity = { distinctId: "default" }
    const overrideIdentity: Identity = { distinctId: "override" }
    const decision: Decision = { type: "boolean", value: true }

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      identify: vi.fn(() => Promise.resolve(defaultIdentity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options, { identity: overrideIdentity })

    expect(result).toBe(true)
    expect(config.identify).not.toHaveBeenCalled()
    expect(config.decide).toHaveBeenCalledWith("test-flag", overrideIdentity, expect.any(Object))
  })

  test("returns default value on error", async () => {
    const config = {
      decide: vi.fn(() => Promise.resolve({ type: "boolean", value: true } as const)),
      identify: vi.fn(() => Promise.reject(new Error("Identity error"))),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(false)
  })

  test("runs all hook lifecycle methods", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "boolean", value: true }

    const beforeFn = vi.fn(() => Promise.resolve())
    const afterFn = vi.fn(() => Promise.resolve())
    const finallyFn = vi.fn(() => Promise.resolve())

    const hooks: Hook[] = [
      {
        after: afterFn,
        before: beforeFn,
        finally: finallyFn,
      },
    ]

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      hooks,
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    await executeGate(config, options)
    await sleep(0)

    expect(beforeFn).toHaveBeenCalled()
    expect(afterFn).toHaveBeenCalled()
    expect(finallyFn).toHaveBeenCalled()
  })

  test("short-circuits when the cache returns a decision", async () => {
    const identity: Identity = { distinctId: "user123" }
    const cachedDecision: Decision = { type: "boolean", value: true }

    const config = {
      cache: {
        get: vi.fn(() => Promise.resolve(cachedDecision)),
        set: vi.fn(() => Promise.resolve()),
      },
      decide: vi.fn(() => Promise.resolve({ type: "boolean", value: false } as const)),
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
    expect(config.decide).not.toHaveBeenCalled()
  })

  test("runs error hooks when error occurs", async () => {
    const error = new Error("Decision error")

    const errorFn = vi.fn(() => Promise.resolve())
    const finallyFn = vi.fn(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn, finally: finallyFn }]

    const config = {
      decide: vi.fn(() => Promise.reject(error)),
      hooks,
      identify: vi.fn(() => Promise.resolve({ distinctId: "user123" })),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(false)
    expect(errorFn).toHaveBeenCalledWith(
      {
        defaultValue: false,
        flagKey: "test-flag",
        identity: { distinctId: "user123" },
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      },
      error
    )
    expect(finallyFn).toHaveBeenCalled()
  })

  test("validates variant and throws on invalid variant", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "variant", variant: "invalid" }

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    }

    const result = await executeGate(config, options)

    expect(result).toBe("light") // Returns default on error
  })

  test("rejects a non-boolean default for a boolean gate at runtime", async () => {
    const config = {
      decide: () => ({ type: "boolean", value: true }) as const,
      identify: () => ({ distinctId: "user123" }),
    }
    const options = { defaultValue: "false", key: "beta-access" } as unknown as {
      defaultValue: boolean
      key: string
    }

    await expectRejection(
      executeGate(config, options),
      "A boolean evaluation requires a boolean default value"
    )
  })

  test("rejects a non-string default for a variant gate at runtime", async () => {
    const config = {
      decide: () => ({ type: "variant", variant: "dark" }) as const,
      identify: () => ({ distinctId: "user123" }),
    }
    const options = {
      defaultValue: false,
      key: "theme",
      variants: ["light", "dark"],
    } as unknown as {
      defaultValue: string
      key: string
      variants: string[]
    }

    await expectRejection(
      executeGate(config, options),
      "A variant evaluation requires a string default value"
    )
  })

  test("works without hooks", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "boolean", value: true }

    const config = {
      decide: vi.fn(() => Promise.resolve(decision)),
      identify: vi.fn(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
  })

  test("handles null identity in hook context on error", async () => {
    const errorFn = vi.fn(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn }]

    const config = {
      decide: vi.fn(() => Promise.resolve({ type: "boolean", value: true } as const)),
      hooks,
      identify: vi.fn(() => Promise.reject(new Error("Identity error"))),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    await executeGate(config, options)

    expect(errorFn).toHaveBeenCalledWith(
      {
        defaultValue: false,
        flagKey: "test-flag",
        identity: null,
        kind: "boolean",
        signal: expect.any(AbortSignal),
        variants: undefined,
      },
      expect.any(Error)
    )
  })
})
