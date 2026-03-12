import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, HookContext, Identity } from "../../lib/types"
import { createHook } from "../index"

describe("createHook", () => {
  test("returns the factory function", () => {
    const hook = createHook(() => ({}))

    expect(hook).toBeTypeOf("function")
  })

  test("creates a hook with no options", () => {
    const beforeFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      before: beforeFn,
    }))

    const result = hook()

    expect(result).toBeDefined()
    expect(result.before === beforeFn).toBe(true)
  })

  test("creates a hook with options", () => {
    type Options = { prefix: string }
    const beforeFn = mock(() => {
      // Hook function
    })
    const hook = createHook((_options: Options) => ({
      before: beforeFn,
    }))

    const result = hook({ prefix: "LOG" })

    expect(result).toBeDefined()
    expect(typeof result.before).toBe("function")
  })

  test("supports all hook lifecycle methods", () => {
    const beforeFn = mock(() => {
      // Hook function
    })
    const resolveFn = mock((): Decision | undefined => undefined)
    const afterFn = mock(() => {
      // Hook function
    })
    const errorFn = mock(() => {
      // Hook function
    })
    const finallyFn = mock(() => {
      // Hook function
    })

    const hook = createHook(() => ({
      after: afterFn,
      before: beforeFn,
      error: errorFn,
      finally: finallyFn,
      resolve: resolveFn,
    }))

    const result = hook()

    expect(result.before === beforeFn).toBe(true)
    expect(result.resolve === resolveFn).toBe(true)
    expect(result.after === afterFn).toBe(true)
    expect(result.error === errorFn).toBe(true)
    expect(result.finally === finallyFn).toBe(true)
  })

  test("hook before method receives context", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      before: beforeFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await result.before?.(context)

    expect(beforeFn).toHaveBeenCalledWith(context)
  })

  test("hook resolve method receives context and returns decision", async () => {
    const decision: Decision = { value: true }
    const resolveFn = mock(() => decision)
    const hook = createHook(() => ({
      resolve: resolveFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const resolvedDecision = await result.resolve?.(context)

    expect(resolveFn).toHaveBeenCalledWith(context)
    expect(resolvedDecision).toEqual(decision)
  })

  test("hook after method receives context and decision", async () => {
    const afterFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      after: afterFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: false }

    await result.after?.(context, decision)

    expect(afterFn).toHaveBeenCalledWith(context, decision)
  })

  test("hook error method receives context and error", async () => {
    const errorFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      error: errorFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await result.error?.(context, error)

    expect(errorFn).toHaveBeenCalledWith(context, error)
  })

  test("hook finally method receives context", async () => {
    const finallyFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      finally: finallyFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await result.finally?.(context)

    expect(finallyFn).toHaveBeenCalledWith(context)
  })

  test("supports custom identity types", () => {
    interface CustomIdentity extends Identity {
      email: string
      plan: "free" | "pro"
    }

    const beforeFn = mock(() => {
      // Hook function
    })

    const hook = createHook(() => ({
      before: beforeFn,
    })) as () => Hook<CustomIdentity>

    const result = hook()

    expect(result).toBeDefined()
    expect(typeof result.before).toBe("function")
  })

  test("supports partial hook implementations", () => {
    const hook = createHook(() => ({
      before: () => {
        // Hook function
      },
      // Only before is implemented
    }))

    const result = hook()

    expect(result.before === undefined).toBe(false)
    expect(result.resolve === undefined).toBe(true)
    expect(result.after === undefined).toBe(true)
    expect(result.error === undefined).toBe(true)
    expect(result.finally === undefined).toBe(true)
  })

  test("hook with options can access options in all lifecycle methods", async () => {
    type Options = { logPrefix: string }
    const logs: string[] = []

    const hook = createHook<Options>((options) => ({
      after: (ctx, dec) => {
        const value = "value" in dec ? dec.value : dec.variant
        logs.push(`${options.logPrefix}:after:${ctx.flagKey}:${value}`)
      },
      before: (ctx) => {
        logs.push(`${options.logPrefix}:before:${ctx.flagKey}`)
      },
    }))

    const result = hook({ logPrefix: "TEST" })
    const context: HookContext = {
      flagKey: "my-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    await result.before?.(context)
    await result.after?.(context, decision)

    expect(logs).toEqual(["TEST:before:my-flag", "TEST:after:my-flag:true"])
  })

  test("hook resolve can return undefined to skip resolution", async () => {
    const hook = createHook(() => ({
      resolve: (): Decision | undefined => undefined,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const decision = await result.resolve?.(context)

    expect(decision).toBeUndefined()
  })

  test("hook resolve can return a decision to short-circuit", async () => {
    const cachedDecision: Decision = { value: true }
    const hook = createHook(() => ({
      resolve: () => cachedDecision,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const decision = await result.resolve?.(context)

    expect(decision).toEqual(cachedDecision)
  })

  test("supports variant decisions", async () => {
    const afterFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      after: afterFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "theme-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { variant: "dark" }

    await result.after?.(context, decision)

    expect(afterFn).toHaveBeenCalledWith(context, decision)
  })

  test("supports null identity in context", async () => {
    const beforeFn = mock(() => {
      // Hook function
    })
    const hook = createHook(() => ({
      before: beforeFn,
    }))

    const result = hook()
    const context: HookContext = {
      flagKey: "test-flag",
      identity: null,
    }

    await result.before?.(context)

    expect(beforeFn).toHaveBeenCalledWith(context)
  })

  test("multiple hooks can be created from same factory", () => {
    const beforeFn = mock(() => {
      // Hook function
    })

    const hook = createHook((_prefix: string) => ({
      before: beforeFn,
    }))

    const hook1 = hook("HOOK1")
    const hook2 = hook("HOOK2")

    expect(hook1).toBeDefined()
    expect(hook2).toBeDefined()
    expect(hook1).not.toBe(hook2)
  })
})
