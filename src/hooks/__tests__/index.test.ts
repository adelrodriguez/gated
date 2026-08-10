import { describe, expect, test } from "bun:test"
import type { Hook, HookContext, Identity } from "../../lib/types"
import { decision } from "../../decision"
import { buildGate } from "../../factory"
import { defineHook } from "../index"

const context: HookContext = {
  defaultValue: false,
  flagKey: "beta",
  identity: { distinctId: "user-1" },
  kind: "boolean",
  signal: new AbortController().signal,
}

describe("defineHook", () => {
  test("returns a direct observer hook unchanged", async () => {
    let source: "cache" | "provider" | undefined
    const definition: Hook = {
      after(_context, _decision, metadata) {
        source = metadata.source
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
    expect(source).toBe("provider")
  })

  test("contextually types custom identities", () => {
    interface AccountIdentity extends Identity {
      plan: "free" | "pro"
    }
    const hook = defineHook<AccountIdentity>({
      before(hookContext) {
        const plan: "free" | "pro" | undefined = hookContext.identity?.plan
        expect(plan).toBe("pro")
      },
    })

    return hook.before?.({
      ...context,
      identity: { distinctId: "user-1", plan: "pro" },
    })
  })

  test("defines typed option factories", () => {
    const factory = defineHook<{ prefix: string }>((options) => ({
      before(hookContext) {
        expect(`${options.prefix}:${hookContext.flagKey}`).toBe("audit:beta")
      },
    }))
    const hook = factory({ prefix: "audit" })

    return hook.before?.(context)
  })

  test("keeps closure state isolated between factory invocations", async () => {
    const factory = defineHook(() => {
      const starts = new WeakMap<HookContext, number>()
      return {
        after(hookContext: HookContext) {
          expect(starts.get(hookContext)).toBe(1)
          starts.delete(hookContext)
        },
        before(hookContext: HookContext) {
          starts.set(hookContext, 1)
        },
      }
    })
    const first = factory()
    const second = factory()

    await first.before?.(context)
    await first.after?.(context, decision.boolean(true), { source: "provider" })
    await second.before?.(context)
    await second.after?.(context, decision.boolean(true), { source: "provider" })
  })

  test("accepts partial observer implementations", () => {
    const hook = defineHook({ before: () => Promise.resolve() })

    expect(typeof hook.before).toBe("function")
    expect("after" in hook).toBe(false)
    expect("error" in hook).toBe(false)
    expect("finally" in hook).toBe(false)
  })
})
