import { describe, expect, test } from "bun:test"
import type { Hook, Identity } from "../../lib/types"
import { buildGate } from "../../factory"
import { decision } from "../../lib/decision"
import { defineHook } from "../index"

describe("defineHook", () => {
  test("returns a direct hook unchanged and integrates with a gate", async () => {
    let source: "hook" | "provider" | undefined
    let afterCalls = 0
    const definition: Hook = {
      after(_context, _decision, metadata) {
        const typedSource: "hook" | "provider" = metadata.source
        afterCalls += 1
        source = typedSource
      },
    }
    const hook = defineHook(definition)
    const gate = buildGate({
      decide: () => decision.boolean(true),
      hooks: [hook],
      identify: () => ({ distinctId: "user-1" }),
    })

    expect(hook).toBe(definition)
    expect(await gate({ defaultValue: false, key: "beta" })()).toBe(true)
    expect(afterCalls).toBe(1)
    expect(source).toBe("provider")
  })

  test("contextually types direct hooks for custom identities", () => {
    interface AccountIdentity extends Identity {
      plan: "free" | "pro"
    }

    const hook = defineHook<AccountIdentity>({
      before(context) {
        const plan: "free" | "pro" | undefined = context.identity?.plan
        expect(plan).toBe("pro")
      },
    })

    expect(typeof hook.before).toBe("function")
    return hook.before?.({
      defaultValue: false,
      flagKey: "beta",
      identity: { distinctId: "user-1", plan: "pro" },
      kind: "boolean",
      signal: new AbortController().signal,
      state: new Map(),
    })
  })

  test("contextually types direct after-hook metadata", () => {
    const hook = defineHook({
      after(_context, _decision, metadata) {
        const source: "hook" | "provider" = metadata.source
        expect(source).toBe("provider")
      },
    })

    expect(typeof hook.after).toBe("function")
    return hook.after?.(
      {
        defaultValue: false,
        flagKey: "beta",
        identity: { distinctId: "user-1" },
        kind: "boolean",
        signal: new AbortController().signal,
        state: new Map(),
      },
      decision.boolean(true),
      { source: "provider" }
    )
  })

  test("defines a typed options factory", () => {
    const factory = defineHook<{ prefix: string }>((options) => ({
      before(context) {
        expect(`${options.prefix}:${context.flagKey}`).toBe("audit:beta")
      },
    }))

    const hook: Hook = factory({ prefix: "audit" })

    expect(typeof hook.before).toBe("function")
    return hook.before?.({
      defaultValue: false,
      flagKey: "beta",
      identity: { distinctId: "user-1" },
      kind: "boolean",
      signal: new AbortController().signal,
      state: new Map(),
    })
  })

  test("contextually types annotated and optional factory options", () => {
    interface AuditOptions {
      prefix: string
    }

    const annotatedFactory = defineHook((options: AuditOptions) => ({
      finally(context) {
        const flagKey: string = context.flagKey
        expect(`${options.prefix}:${flagKey}`).toBe("audit:beta")
      },
    }))
    const optionalFactory = defineHook((options?: AuditOptions) => ({
      before() {
        void options?.prefix
      },
    }))
    const context = {
      defaultValue: false,
      flagKey: "beta",
      identity: { distinctId: "user-1" },
      kind: "boolean",
      signal: new AbortController().signal,
      state: new Map(),
    } as const

    const annotated = annotatedFactory({ prefix: "audit" })
    const optional = optionalFactory({ prefix: "audit" })
    const defaults = optionalFactory()

    expect(typeof optional.before).toBe("function")
    expect(typeof defaults.before).toBe("function")
    expect(typeof annotated.finally).toBe("function")
    return annotated.finally?.(context)
  })

  test("keeps state isolated between factory invocations", async () => {
    const factory = defineHook(() => {
      let calls = 0
      return {
        resolve() {
          calls += 1
          return decision.boolean(calls > 1)
        },
      }
    })
    const first = factory()
    const second = factory()
    const context = {
      defaultValue: false,
      flagKey: "beta",
      identity: { distinctId: "user-1" },
      kind: "boolean",
      signal: new AbortController().signal,
      state: new Map(),
    } as const

    expect(await first.resolve?.(context)).toEqual(decision.boolean(false))
    expect(await first.resolve?.(context)).toEqual(decision.boolean(true))
    expect(await second.resolve?.(context)).toEqual(decision.boolean(false))
  })

  test("accepts partial hook implementations", () => {
    const hook = defineHook({ before: () => Promise.resolve() })

    expect(typeof hook.before).toBe("function")
    expect("resolve" in hook).toBe(false)
    expect("after" in hook).toBe(false)
    expect("error" in hook).toBe(false)
    expect("finally" in hook).toBe(false)
  })
})
