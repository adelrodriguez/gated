import { describe, expect, it } from "vitest"
import * as hooks from "../hooks"
import * as gated from "../index"
import * as react from "../integrations/react"

describe("public entry points", () => {
  it("exposes the core gate factory", async () => {
    const factory = gated.buildGate({
      decide: () => gated.decision.boolean(true),
      identify: () => ({ distinctId: "consumer" }),
    })
    expect(await factory({ defaultValue: false, key: "beta" })()).toBe(true)
  })

  it("exposes hook helpers without the core factory", () => {
    expect(hooks.defineHook({})).toBeTypeOf("object")
    expect("buildGate" in hooks).toBe(false)
  })

  it("no longer exposes the removed React factory from the core entry point", () => {
    expect("createReactGate" in gated).toBe(false)
  })

  it("exposes the final React surface", () => {
    expect(Object.keys(react).toSorted()).toEqual(
      [
        "FeatureGate",
        "GateProvider",
        "createGateCache",
        "useGate",
        "useGateBatch",
        "useGateCache",
      ].toSorted()
    )
  })
})
