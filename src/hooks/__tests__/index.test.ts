import { describe, expect, mock, test } from "bun:test"
import type { Decision, HookContext, Identity } from "../../lib/types"
import { createHook } from "../index"

const providerMeta = { source: "provider" } as const
const BOOLEAN_HOOK_CONTEXT = { defaultValue: false, kind: "boolean" } as const
const factory = () => ({})
const noDecision = (): Decision | undefined => undefined

describe("createHook", () => {
  test("returns the factory function", () => {
    const hook = createHook(factory)

    expect(hook).toBe(factory)
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
    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.before).toBe(beforeFn)
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
    const beforeFn = mock(() => Promise.resolve())
    const resolveFn = mock(() => Promise.resolve(noDecision()))
    const afterFn = mock(() => Promise.resolve())
    const errorFn = mock(() => Promise.resolve())
    const finallyFn = mock(() => Promise.resolve())

    const hook = createHook(() => ({
      after: afterFn,
      before: beforeFn,
      error: errorFn,
      finally: finallyFn,
      resolve: resolveFn,
    }))

    const result = hook()

    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.before).toBe(beforeFn)
    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.resolve).toBe(resolveFn)
    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.after).toBe(afterFn)
    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.error).toBe(errorFn)
    // oxlint-disable-next-line typescript/unbound-method -- Asserts the hook retains the supplied callback reference.
    expect(result.finally).toBe(finallyFn)
  })

  test("hook before method receives context", async () => {
    const beforeFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      before: beforeFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    await result.before?.(context)

    expect(beforeFn).toHaveBeenCalledWith(context)
  })

  test("hook resolve method receives context and returns decision", async () => {
    const decision: Decision = { value: true }
    const resolveFn = mock(() => Promise.resolve(decision))
    const hook = createHook(() => ({
      resolve: resolveFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const resolvedDecision = await result.resolve?.(context)

    expect(resolveFn).toHaveBeenCalledWith(context)
    expect(resolvedDecision).toEqual(decision)
  })

  test("hook after method receives context and decision", async () => {
    const afterFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      after: afterFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: false }

    await result.after?.(context, decision, providerMeta)

    expect(afterFn).toHaveBeenCalledWith(context, decision, providerMeta)
  })

  test("hook error method receives context and error", async () => {
    const errorFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      error: errorFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }
    const error = new Error("Test error")

    await result.error?.(context, error)

    expect(errorFn).toHaveBeenCalledWith(context, error)
  })

  test("hook finally method receives context", async () => {
    const finallyFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      finally: finallyFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
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

    const beforeFn = mock(() => Promise.resolve())

    // oxlint-disable-next-line typescript/no-invalid-void-type -- `void` represents a hook factory without options.
    const hook = createHook<void, CustomIdentity>(() => ({
      before: beforeFn,
    }))

    const result = hook()

    expect(result).toBeDefined()
    expect(typeof result.before).toBe("function")
  })

  test("supports partial hook implementations", () => {
    const hook = createHook(() => ({
      before: () => Promise.resolve(),
      // Only before is implemented
    }))

    const result = hook()

    // oxlint-disable-next-line typescript/unbound-method -- Verifies the implemented callback exists.
    expect(result.before).toBeDefined()
    // oxlint-disable-next-line typescript/unbound-method -- Verifies the optional callback is absent.
    expect(result.resolve).toBeUndefined()
    // oxlint-disable-next-line typescript/unbound-method -- Verifies the optional callback is absent.
    expect(result.after).toBeUndefined()
    // oxlint-disable-next-line typescript/unbound-method -- Verifies the optional callback is absent.
    expect(result.error).toBeUndefined()
    // oxlint-disable-next-line typescript/unbound-method -- Verifies the optional callback is absent.
    expect(result.finally).toBeUndefined()
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
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "my-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { value: true }

    await result.before?.(context)
    await result.after?.(context, decision, providerMeta)

    expect(logs).toEqual(["TEST:before:my-flag", "TEST:after:my-flag:true"])
  })

  test("hook resolve can return undefined to skip resolution", async () => {
    const hook = createHook(() => ({
      resolve: () => Promise.resolve(noDecision()),
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const decision = await result.resolve?.(context)

    expect(decision).toBeUndefined()
  })

  test("hook resolve can return a decision to short-circuit", async () => {
    const cachedDecision: Decision = { value: true }
    const hook = createHook(() => ({
      resolve: () => Promise.resolve(cachedDecision),
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "test-flag",
      identity: { distinctId: "user123" },
    }

    const decision = await result.resolve?.(context)

    expect(decision).toEqual(cachedDecision)
  })

  test("supports variant decisions", async () => {
    const afterFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      after: afterFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
      flagKey: "theme-flag",
      identity: { distinctId: "user123" },
    }
    const decision: Decision = { variant: "dark" }

    await result.after?.(context, decision, providerMeta)

    expect(afterFn).toHaveBeenCalledWith(context, decision, providerMeta)
  })

  test("supports null identity in context", async () => {
    const beforeFn = mock(() => Promise.resolve())
    const hook = createHook(() => ({
      before: beforeFn,
    }))

    const result = hook()
    const context: HookContext = {
      ...BOOLEAN_HOOK_CONTEXT,
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
