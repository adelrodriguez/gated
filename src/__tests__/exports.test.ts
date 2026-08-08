import { expect, test } from "bun:test"
import type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  GateEvaluator,
  GateFactory,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "../index"
import {
  buildGate,
  DecisionTypeMismatchError,
  GatedError,
  IdentityNotFoundError,
  InvalidVariantError,
} from "../index"

interface TestIdentity extends Identity {
  plan: "free" | "pro"
}

const decision: Decision = { value: true }
const decisionSource: DecisionSource = "provider"
const maybeDecision: MaybePromise<Decision> = decision
const identityValue: IdentityValue = { plan: "pro" }
const hookContext: HookContext<TestIdentity> = {
  defaultValue: false,
  flagKey: "beta-access",
  identity: { distinctId: "test-user", plan: "pro" },
  kind: "boolean",
}
const hook: Hook<TestIdentity> = {
  resolve: () => decision,
}
const afterMeta: AfterHookMeta<TestIdentity> = { source: decisionSource }
const hookAfterMeta: AfterHookMeta<TestIdentity> = { resolver: hook, source: "hook" }
// @ts-expect-error hook-resolved metadata requires the exact resolver
const invalidHookAfterMeta: AfterHookMeta<TestIdentity> = { source: "hook" }
const hookErrorReport: HookErrorReport<TestIdentity> = {
  context: hookContext,
  error: new Error("Hook failed"),
  hookIndex: 0,
  phase: "before",
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

function readGateConfiguration(context: HookContext) {
  if (context.kind === "boolean") {
    const defaultValue: boolean = context.defaultValue
    const variants: undefined = context.variants
    return { defaultValue, variants }
  }

  const defaultValue: string = context.defaultValue
  const variants: readonly string[] = context.variants
  return { defaultValue, variants }
}

test("exports consumer-facing root types", () => {
  // @ts-expect-error -- HookContext no longer accepts an options type argument.
  const legacyContext: HookContext<TestIdentity, { custom: boolean }> = hookContext

  expect(afterMeta.source).toBe("provider")
  expect(hookAfterMeta.resolver).toBe(hook)
  expect(hookErrorReport.context).toBe(hookContext)
  expect(invalidHookAfterMeta.source).toBe("hook")
  expect(identityValue).toEqual({ plan: "pro" })
  expect(maybeDecision).toBe(decision)
  expect(typeof evaluator).toBe("function")
  expect(typeof variantEvaluator).toBe("function")
  expect(legacyContext).toBe(hookContext)
  expect(readGateConfiguration(hookContext)).toEqual({ defaultValue: false, variants: undefined })
  expect(new IdentityNotFoundError()).toBeInstanceOf(GatedError)
  expect(new DecisionTypeMismatchError("boolean", { variant: "dark" })).toBeInstanceOf(GatedError)
  expect(new InvalidVariantError("purple", ["light", "dark"])).toBeInstanceOf(GatedError)
})
