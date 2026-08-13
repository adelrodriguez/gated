import { describe, expect, it } from "bun:test"
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

  it("exposes hook helpers", () => {
    expect(hooks.defineHook({})).toBeObject()
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
