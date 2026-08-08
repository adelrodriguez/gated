import { expect, test } from "bun:test"
import type {
  Decision,
  GateEvaluator,
  GateFactory,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
} from "../index"
import { buildGate } from "../index"

interface TestIdentity extends Identity {
  plan: "free" | "pro"
}

const decision: Decision = { value: true }
const hookContext: HookContext<TestIdentity> = {
  flagKey: "beta-access",
  identity: { distinctId: "test-user", plan: "pro" },
}
const hook: Hook<TestIdentity> = {
  resolve: () => decision,
}
const config: GatedConfig<TestIdentity> = {
  decide: () => Promise.resolve(decision),
  hooks: [hook],
  identify: () => Promise.resolve(hookContext.identity),
}
const gate: GateFactory<TestIdentity> = buildGate(config)
const evaluator: GateEvaluator<TestIdentity, boolean> = gate({
  defaultValue: false,
  key: hookContext.flagKey,
})
const variantEvaluator: GateEvaluator<TestIdentity, "dark" | "light"> = gate({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})

test("exports consumer-facing root types", () => {
  expect(typeof evaluator).toBe("function")
  expect(typeof variantEvaluator).toBe("function")
})
