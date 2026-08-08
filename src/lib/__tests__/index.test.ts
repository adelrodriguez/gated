import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, HookContext, Identity } from "../types"
import { IdentityNotFoundError, MalformedDecisionError } from "../errors"
import {
  evaluateDecision,
  executeGate,
  extractDecisionValue,
  identify,
  runAfterHooks,
  runBeforeHooks,
  runErrorHooks,
  runFinallyHooks,
  runResolveHooks,
  validateDecision,
} from "../index"
import { HookResolutionAbortError } from "../internal"

const BOOLEAN_HOOK_CONTEXT = {
  defaultValue: false,
  kind: "boolean",
  signal: new AbortController().signal,
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
  return caughtError
}

const acceptDecision = (decision: Decision) => void decision

describe("identify", () => {
  test("returns override identity when provided", async () => {
    const identifyFn = mock(() =>
      Promise.resolve<Identity>({
        distinctId: "default",
      })
    )
    const override: Identity = { distinctId: "override" }

    const result = await identify(identifyFn, override)

    expect(result).toEqual(override)
    expect(identifyFn).not.toHaveBeenCalled()
  })

  test("calls identify function when no override provided", async () => {
    const identity: Identity = { distinctId: "user123" }
    const identifyFn = mock(() => Promise.resolve(identity))

    const result = await identify(identifyFn)

    expect(result).toEqual(identity)
    expect(identifyFn).toHaveBeenCalledTimes(1)
  })

  test("treats a null override as not provided", async () => {
    const identity: Identity = { distinctId: "user123" }
    const identifyFn = mock(() => Promise.resolve(identity))

    const result = await identify(identifyFn, null)

    expect(result).toEqual(identity)
    expect(identifyFn).toHaveBeenCalledTimes(1)
  })

  test("throws error when identify function returns null", async () => {
    const identifyFn = mock(() => Promise.resolve(null))

    const error = await expectRejection(identify(identifyFn), "Identity not found")

    expect(error).toBeInstanceOf(IdentityNotFoundError)
  })

  test("handles synchronous identify function", async () => {
    const identity: Identity = { distinctId: "user123" }
    const identifyFn = mock(() => identity)

    const result = await identify(identifyFn)

    expect(result).toEqual(identity)
  })

  test("handles custom identity properties", async () => {
    interface CustomIdentity extends Identity {
      email: string
      plan: "free" | "pro"
    }

    const identity: CustomIdentity = {
      distinctId: "user123",
      email: "user@example.com",
      plan: "pro",
    }
    const identifyFn = mock(() => Promise.resolve(identity))

    const result = await identify(identifyFn)

    expect(result).toEqual(identity)
  })
})

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

describe("evaluateDecision", () => {
  test("evaluates boolean decision", async () => {
    const decision: Decision = { type: "boolean", value: true }
    const decideFn = mock(() => Promise.resolve(decision))
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "test-flag", identity)

    expect(result).toEqual(decision)
    expect(decideFn).toHaveBeenCalledWith("test-flag", identity, { signal: undefined })
  })

  test("evaluates variant decision", async () => {
    const decision: Decision = { type: "variant", variant: "dark" }
    const decideFn = mock(() => Promise.resolve(decision))
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "theme", identity)

    expect(result).toEqual(decision)
  })

  test("handles synchronous decide function", async () => {
    const decision: Decision = { type: "boolean", value: false }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "test-flag", identity)

    expect(result).toEqual(decision)
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

describe("runBeforeHooks", () => {
  test("runs all before hooks", async () => {
    const beforeFn1 = mock(() => Promise.resolve())
    const beforeFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn1 }, { before: beforeFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)

    expect(beforeFn1).toHaveBeenCalledWith(context)
    expect(beforeFn2).toHaveBeenCalledWith(context)
  })

  test("handles hooks without before method", async () => {
    const afterFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ after: afterFn }, {}]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)

    expect(afterFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const beforeFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const beforeFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn1 }, { before: beforeFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)

    expect(beforeFn1).toHaveBeenCalled()
    expect(beforeFn2).toHaveBeenCalled()
  })

  test("runs with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)
  })
})

describe("runResolveHooks", () => {
  test("returns first non-undefined value", async () => {
    const resolveFn1 = mock(() => Promise.resolve<Decision | undefined>(void 0))
    const decision: Decision = { type: "boolean", value: true }
    const resolveFn2 = mock(() => Promise.resolve<Decision | undefined>(decision))
    const resolveFn3 = mock(() =>
      Promise.resolve<Decision | undefined>({ type: "boolean", value: false })
    )
    const resolver: Hook = { resolve: resolveFn2 }

    const hooks: Hook[] = [{ resolve: resolveFn1 }, resolver, { resolve: resolveFn3 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context, acceptDecision)

    expect(result).toEqual({ decision, resolver })
    expect(resolveFn1).toHaveBeenCalled()
    expect(resolveFn2).toHaveBeenCalled()
    expect(resolveFn3).not.toHaveBeenCalled() // Short-circuits
  })

  test("returns undefined if all hooks return undefined", async () => {
    const resolveFn1 = mock(() => Promise.resolve<Decision | undefined>(void 0))
    const resolveFn2 = mock(() => Promise.resolve<Decision | undefined>(void 0))

    const hooks: Hook[] = [{ resolve: resolveFn1 }, { resolve: resolveFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context, acceptDecision)

    expect(result).toBeUndefined()
  })

  test("handles hooks without resolve method", async () => {
    const beforeFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context, acceptDecision)

    expect(result).toBeUndefined()
  })

  test("continues to next hook if one throws error", async () => {
    const resolveFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const decision: Decision = { type: "boolean", value: true }
    const resolveFn2 = mock(() => Promise.resolve(decision))
    const resolver: Hook = { resolve: resolveFn2 }

    const hooks: Hook[] = [{ resolve: resolveFn1 }, resolver]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context, acceptDecision)

    expect(result).toEqual({ decision, resolver })
  })

  test("continues to the next hook if a decision is invalid", async () => {
    const invalidDecision: Decision = { type: "variant", variant: "stale" }
    const validDecision: Decision = { type: "variant", variant: "current" }
    const resolver: Hook = { resolve: () => validDecision }
    const hooks: Hook[] = [{ resolve: () => invalidDecision }, resolver]
    const context: HookContext = {
      defaultValue: "current",
      flagKey: "theme",
      identity: { distinctId: "user123" },
      kind: "variant",
      signal: new AbortController().signal,
      variants: ["current"],
    }

    const result = await runResolveHooks(hooks, context, (decision) => {
      if (decision === invalidDecision) {
        throw new Error("Invalid hook decision")
      }
    })

    expect(result).toEqual({ decision: validDecision, resolver })
  })

  test("throws an Error when an abort has no Error reason", async () => {
    const hooks: Hook[] = [
      { resolve: () => Promise.reject(new HookResolutionAbortError(undefined)) },
    ]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await expectRejection(
      runResolveHooks(hooks, context, acceptDecision),
      "Hook resolution aborted"
    )
  })

  test("returns undefined with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context, acceptDecision)

    expect(result).toBeUndefined()
  })
})

describe("runAfterHooks", () => {
  const providerMeta = { source: "provider" } as const

  test("runs all after hooks with decision", async () => {
    const afterFn1 = mock(() => Promise.resolve())
    const afterFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ after: afterFn1 }, { after: afterFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: true }

    await runAfterHooks(hooks, context, decision, providerMeta)

    expect(afterFn1).toHaveBeenCalledWith(context, decision, { source: "provider" })
    expect(afterFn2).toHaveBeenCalledWith(context, decision, { source: "provider" })
  })

  test("handles hooks without after method", async () => {
    const beforeFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: false }

    await runAfterHooks(hooks, context, decision, providerMeta)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const afterFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const afterFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ after: afterFn1 }, { after: afterFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "variant", variant: "dark" }

    await runAfterHooks(hooks, context, decision, providerMeta)

    expect(afterFn1).toHaveBeenCalled()
    expect(afterFn2).toHaveBeenCalled()
  })

  test("runs with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { type: "boolean", value: true }

    await runAfterHooks(hooks, context, decision, providerMeta)
  })
})

describe("runErrorHooks", () => {
  test("runs all error hooks with error", async () => {
    const errorFn1 = mock(() => Promise.resolve())
    const errorFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn1 }, { error: errorFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)

    expect(errorFn1).toHaveBeenCalledWith(context, error)
    expect(errorFn2).toHaveBeenCalledWith(context, error)
  })

  test("handles hooks without error method", async () => {
    const beforeFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const errorFn1 = mock(() => Promise.reject(new Error("Hook processing error")))
    const errorFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn1 }, { error: errorFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Original error")

    await runErrorHooks(hooks, context, error)

    expect(errorFn1).toHaveBeenCalled()
    expect(errorFn2).toHaveBeenCalled()
  })

  test("runs with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)
  })
})

describe("runFinallyHooks", () => {
  test("runs all finally hooks", async () => {
    const finallyFn1 = mock(() => Promise.resolve())
    const finallyFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ finally: finallyFn1 }, { finally: finallyFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)

    expect(finallyFn1).toHaveBeenCalledWith(context)
    expect(finallyFn2).toHaveBeenCalledWith(context)
  })

  test("handles hooks without finally method", async () => {
    const beforeFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const finallyFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const finallyFn2 = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ finally: finallyFn1 }, { finally: finallyFn2 }]
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)

    expect(finallyFn1).toHaveBeenCalled()
    expect(finallyFn2).toHaveBeenCalled()
  })

  test("runs with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)
  })
})

describe("executeGate", () => {
  test("executes boolean gate successfully", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "boolean", value: true }

    const config = {
      decide: mock(() => Promise.resolve(decision)),
      hooks: [],
      identify: mock(() => Promise.resolve(identity)),
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
      decide: mock(() => Promise.resolve(decision)),
      hooks: [],
      identify: mock(() => Promise.resolve(identity)),
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
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(defaultIdentity)),
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
      decide: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      identify: mock(() => Promise.reject(new Error("Identity error"))),
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

    const beforeFn = mock(() => Promise.resolve())
    const resolveFn = mock(() => Promise.resolve<Decision | undefined>(void 0))
    const afterFn = mock(() => Promise.resolve())
    const finallyFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [
      {
        after: afterFn,
        before: beforeFn,
        finally: finallyFn,
        resolve: resolveFn,
      },
    ]

    const config = {
      decide: mock(() => Promise.resolve(decision)),
      hooks,
      identify: mock(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    await executeGate(config, options)

    expect(beforeFn).toHaveBeenCalled()
    expect(resolveFn).toHaveBeenCalled()
    expect(afterFn).toHaveBeenCalled()
    expect(finallyFn).toHaveBeenCalled()
  })

  test("short-circuits when resolve hook returns value", async () => {
    const identity: Identity = { distinctId: "user123" }
    const cachedDecision: Decision = { type: "boolean", value: true }

    const resolveFn = mock(() => Promise.resolve(cachedDecision))

    const hooks: Hook[] = [{ resolve: resolveFn }]

    const config = {
      decide: mock(() => Promise.resolve({ type: "boolean", value: false } as const)),
      hooks,
      identify: mock(() => Promise.resolve(identity)),
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

    const errorFn = mock(() => Promise.resolve())
    const finallyFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn, finally: finallyFn }]

    const config = {
      decide: mock(() => Promise.reject(error)),
      hooks,
      identify: mock(() => Promise.resolve({ distinctId: "user123" })),
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
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    }

    const result = await executeGate(config, options)

    expect(result).toBe("light") // Returns default on error
  })

  test("works without hooks", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { type: "boolean", value: true }

    const config = {
      decide: mock(() => Promise.resolve(decision)),
      identify: mock(() => Promise.resolve(identity)),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
  })

  test("handles null identity in hook context on error", async () => {
    const errorFn = mock(() => Promise.resolve())

    const hooks: Hook[] = [{ error: errorFn }]

    const config = {
      decide: mock(() => Promise.resolve({ type: "boolean", value: true } as const)),
      hooks,
      identify: mock(() => Promise.reject(new Error("Identity error"))),
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
