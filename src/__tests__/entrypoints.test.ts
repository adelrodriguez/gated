import { describe, expect, it } from "bun:test"
import * as hooks from "../hooks"
import * as gated from "../index"
import * as react from "../integrations/react"

describe("public entry points", () => {
  it("exposes and runs the core gate factory", async () => {
    const factory = gated.buildGate({
      decide: () => gated.decision.boolean(true),
      identify: () => ({ distinctId: "consumer" }),
    })
    const evaluator = factory({ defaultValue: false, key: "beta-access" })

    expect(await evaluator()).toBe(true)
    expect(await evaluator.details()).toMatchObject({
      flagKey: "beta-access",
      source: "provider",
      value: true,
    })
  })

  it("exposes hook helpers from the hooks entry point", () => {
    const hook = hooks.defineHook({
      before: (context) => {
        void context
      },
    })

    expect(typeof hook.before).toBe("function")
  })

  it("exposes the React integration from the React entry point", () => {
    const cache = react.createReactGateCache()

    expect(typeof cache.get).toBe("function")
    expect(typeof cache.set).toBe("function")
    expect(react.createReactGate).toBeFunction()
    expect(react.FeatureGate).toBeFunction()
    expect(react.GateCacheProvider).toBeFunction()
  })

  it("keeps entry-point namespaces intentional", () => {
    expect(gated.defineHook).toBeFunction()
    expect("createReactGate" in gated).toBe(false)
    expect("buildGate" in hooks).toBe(false)
    expect("buildGate" in react).toBe(false)
  })
})
