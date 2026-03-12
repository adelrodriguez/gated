import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, HookContext, Identity } from "../types"
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
} from "../index"

describe("identify", () => {
  test("returns override identity when provided", async () => {
    const identifyFn = mock(
      (): Identity => ({
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
    const identifyFn = mock(() => identity)

    const result = await identify(identifyFn)

    expect(result).toEqual(identity)
    expect(identifyFn).toHaveBeenCalledTimes(1)
  })

  test("throws error when identify function returns null", () => {
    const identifyFn = mock(() => null)

    expect(identify(identifyFn)).rejects.toThrow("Identity not found")
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
    const identifyFn = mock(() => identity)

    const result = await identify(identifyFn)

    expect(result).toEqual(identity)
  })
})

describe("extractDecisionValue", () => {
  test("extracts boolean value from boolean decision", () => {
    const decision: Decision = { value: true }

    const result = extractDecisionValue(decision)

    expect(result).toBe(true)
  })

  test("extracts variant from variant decision", () => {
    const decision: Decision = { variant: "dark" }

    const result = extractDecisionValue(decision)

    expect(result).toBe("dark")
  })

  test("validates boolean decision when expected type is boolean", () => {
    const decision: Decision = { value: false }

    const result = extractDecisionValue(decision, "boolean")

    expect(result).toBe(false)
  })

  test("validates variant decision when expected type is variant", () => {
    const decision: Decision = { variant: "light" }

    const result = extractDecisionValue(decision, "variant")

    expect(result).toBe("light")
  })

  test("throws error when expecting boolean but receives variant", () => {
    const decision: Decision = { variant: "dark" }

    expect(() => extractDecisionValue(decision, "boolean")).toThrow(
      'Type mismatch: expected boolean decision but received variant "dark"'
    )
  })

  test("throws error when expecting variant but receives boolean", () => {
    const decision: Decision = { value: true }

    expect(() => extractDecisionValue(decision, "variant")).toThrow(
      'Type mismatch: expected variant decision but received boolean "true"'
    )
  })

  test("extracts value without type validation when no expected type", () => {
    const booleanDecision: Decision = { value: true }
    const variantDecision: Decision = { variant: "system" }

    expect(extractDecisionValue(booleanDecision)).toBe(true)
    expect(extractDecisionValue(variantDecision)).toBe("system")
  })
})

describe("evaluateDecision", () => {
  test("evaluates boolean decision", async () => {
    const decision: Decision = { value: true }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "test-flag", identity)

    expect(result).toEqual(decision)
    expect(decideFn).toHaveBeenCalledWith("test-flag", identity)
  })

  test("evaluates variant decision without validation when no variants provided", async () => {
    const decision: Decision = { variant: "dark" }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "theme", identity)

    expect(result).toEqual(decision)
  })

  test("validates variant against allowed variants", async () => {
    const decision: Decision = { variant: "dark" }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }
    const variants = ["light", "dark", "system"]

    const result = await evaluateDecision(decideFn, "theme", identity, variants)

    expect(result).toEqual(decision)
  })

  test("throws error for invalid variant", () => {
    const decision: Decision = { variant: "purple" }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }
    const variants = ["light", "dark", "system"]

    expect(evaluateDecision(decideFn, "theme", identity, variants)).rejects.toThrow(
      "Invalid variant: purple"
    )
  })

  test("handles synchronous decide function", async () => {
    const decision: Decision = { value: false }
    const decideFn = mock(() => decision)
    const identity: Identity = { distinctId: "user123" }

    const result = await evaluateDecision(decideFn, "test-flag", identity)

    expect(result).toEqual(decision)
  })
})

describe("runBeforeHooks", () => {
  test("runs all before hooks", async () => {
    const beforeFn1 = mock(() => {
      // Hook function
    })
    const beforeFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn1 }, { before: beforeFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)

    expect(beforeFn1).toHaveBeenCalledWith(context)
    expect(beforeFn2).toHaveBeenCalledWith(context)
  })

  test("handles hooks without before method", async () => {
    const afterFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ after: afterFn }, {}]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)

    expect(afterFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const beforeFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const beforeFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn1 }, { before: beforeFn2 }]
    const context: HookContext = {
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
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runBeforeHooks(hooks, context)
  })
})

describe("runResolveHooks", () => {
  test("returns first non-undefined value", async () => {
    const resolveFn1 = mock((): Decision | undefined => undefined)
    const decision: Decision = { value: true }
    const resolveFn2 = mock((): Decision | undefined => decision)
    const resolveFn3 = mock((): Decision | undefined => ({ value: false }))

    const hooks: Hook[] = [
      { resolve: resolveFn1 },
      { resolve: resolveFn2 },
      { resolve: resolveFn3 },
    ]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context)

    expect(result).toEqual(decision)
    expect(resolveFn1).toHaveBeenCalled()
    expect(resolveFn2).toHaveBeenCalled()
    expect(resolveFn3).not.toHaveBeenCalled() // Short-circuits
  })

  test("returns undefined if all hooks return undefined", async () => {
    const resolveFn1 = mock((): Decision | undefined => undefined)
    const resolveFn2 = mock((): Decision | undefined => undefined)

    const hooks: Hook[] = [{ resolve: resolveFn1 }, { resolve: resolveFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context)

    expect(result).toBeUndefined()
  })

  test("handles hooks without resolve method", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context)

    expect(result).toBeUndefined()
  })

  test("continues to next hook if one throws error", async () => {
    const resolveFn1 = mock(() => {
      throw new Error("Hook error")
    })
    const decision: Decision = { value: true }
    const resolveFn2 = mock(() => decision)

    const hooks: Hook[] = [{ resolve: resolveFn1 }, { resolve: resolveFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context)

    expect(result).toEqual(decision)
  })

  test("returns undefined with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const result = await runResolveHooks(hooks, context)

    expect(result).toBeUndefined()
  })
})

describe("runAfterHooks", () => {
  test("runs all after hooks with decision", async () => {
    const afterFn1 = mock(() => {
      // Hook function
    })
    const afterFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ after: afterFn1 }, { after: afterFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    await runAfterHooks(hooks, context, decision)

    expect(afterFn1).toHaveBeenCalledWith(context, decision)
    expect(afterFn2).toHaveBeenCalledWith(context, decision)
  })

  test("handles hooks without after method", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: false }

    await runAfterHooks(hooks, context, decision)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const afterFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const afterFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ after: afterFn1 }, { after: afterFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { variant: "dark" }

    await runAfterHooks(hooks, context, decision)

    expect(afterFn1).toHaveBeenCalled()
    expect(afterFn2).toHaveBeenCalled()
  })

  test("runs with empty hooks array", async () => {
    const hooks: Hook[] = []
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    await runAfterHooks(hooks, context, decision)
  })
})

describe("runErrorHooks", () => {
  test("runs all error hooks with error", async () => {
    const errorFn1 = mock(() => {
      // Hook function
    })
    const errorFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ error: errorFn1 }, { error: errorFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)

    expect(errorFn1).toHaveBeenCalledWith(context, error)
    expect(errorFn2).toHaveBeenCalledWith(context, error)
  })

  test("handles hooks without error method", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const errorFn1 = mock(() => Promise.reject(new Error("Hook processing error")))
    const errorFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ error: errorFn1 }, { error: errorFn2 }]
    const context: HookContext = {
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
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await runErrorHooks(hooks, context, error)
  })
})

describe("runFinallyHooks", () => {
  test("runs all finally hooks", async () => {
    const finallyFn1 = mock(() => {
      // Hook function
    })
    const finallyFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ finally: finallyFn1 }, { finally: finallyFn2 }]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)

    expect(finallyFn1).toHaveBeenCalledWith(context)
    expect(finallyFn2).toHaveBeenCalledWith(context)
  })

  test("handles hooks without finally method", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ before: beforeFn }, {}]
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)

    expect(beforeFn).not.toHaveBeenCalled()
  })

  test("continues execution even if hook fails", async () => {
    const finallyFn1 = mock(() => Promise.reject(new Error("Hook error")))
    const finallyFn2 = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ finally: finallyFn1 }, { finally: finallyFn2 }]
    const context: HookContext = {
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
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await runFinallyHooks(hooks, context)
  })
})

describe("executeGate", () => {
  test("executes boolean gate successfully", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { value: true }

    const config = {
      decide: mock(() => decision),
      hooks: [],
      identify: mock(() => identity),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
    expect(config.identify).toHaveBeenCalled()
    expect(config.decide).toHaveBeenCalledWith("test-flag", identity)
  })

  test("executes variant gate successfully", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { variant: "dark" }

    const config = {
      decide: mock(() => decision),
      hooks: [],
      identify: mock(() => identity),
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
    const decision: Decision = { value: true }

    const config = {
      decide: mock(() => decision),
      identify: mock(() => defaultIdentity),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options, overrideIdentity)

    expect(result).toBe(true)
    expect(config.identify).not.toHaveBeenCalled()
    expect(config.decide).toHaveBeenCalledWith("test-flag", overrideIdentity)
  })

  test("returns default value on error", async () => {
    const config = {
      decide: mock(() => ({ value: true })),
      identify: mock(() => {
        throw new Error("Identity error")
      }),
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
    const decision: Decision = { value: true }

    const beforeFn = mock(() => {
      // Hook function
    })
    const resolveFn = mock((): Decision | undefined => undefined)
    const afterFn = mock(() => {
      // Hook function
    })
    const finallyFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [
      {
        after: afterFn,
        before: beforeFn,
        finally: finallyFn,
        resolve: resolveFn,
      },
    ]

    const config = {
      decide: mock(() => decision),
      hooks,
      identify: mock(() => identity),
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
    const cachedDecision: Decision = { value: true }

    const resolveFn = mock(() => cachedDecision)

    const hooks: Hook[] = [{ resolve: resolveFn }]

    const config = {
      decide: mock(() => ({ value: false })),
      hooks,
      identify: mock(() => identity),
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

    const errorFn = mock(() => {
      // Hook function
    })
    const finallyFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ error: errorFn, finally: finallyFn }]

    const config = {
      decide: mock(() => {
        throw error
      }),
      hooks,
      identify: mock(() => ({ distinctId: "user123" })),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(false)
    expect(errorFn).toHaveBeenCalledWith(
      {
        flagKey: "test-flag",
        identity: { distinctId: "user123" },
      },
      error
    )
    expect(finallyFn).toHaveBeenCalled()
  })

  test("validates variant and throws on invalid variant", async () => {
    const identity: Identity = { distinctId: "user123" }
    const decision: Decision = { variant: "invalid" }

    const config = {
      decide: mock(() => decision),
      identify: mock(() => identity),
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
    const decision: Decision = { value: true }

    const config = {
      decide: mock(() => decision),
      identify: mock(() => identity),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    const result = await executeGate(config, options)

    expect(result).toBe(true)
  })

  test("handles null identity in hook context on error", async () => {
    const errorFn = mock(() => {
      // Hook function
    })

    const hooks: Hook[] = [{ error: errorFn }]

    const config = {
      decide: mock(() => ({ value: true })),
      hooks,
      identify: mock(() => {
        throw new Error("Identity error")
      }),
    }

    const options = {
      defaultValue: false,
      key: "test-flag",
    }

    await executeGate(config, options)

    expect(errorFn).toHaveBeenCalledWith(
      {
        flagKey: "test-flag",
        identity: null,
      },
      expect.any(Error)
    )
  })
})
