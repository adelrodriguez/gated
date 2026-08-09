import { expect, test } from "bun:test"
import type {
  AfterHookMeta,
  AnonymousGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateCallOptions,
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
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  decision as decisions,
} from "../index"

interface TestIdentity extends Identity {
  plan: "free" | "pro"
}

const decision: Decision = { type: "boolean", value: true }
const decisionSource: DecisionSource = "provider"
const maybeDecision: MaybePromise<Decision> = decision
const identityValue: IdentityValue = { plan: "pro" }
const hookContext: HookContext<TestIdentity> = {
  defaultValue: false,
  flagKey: "beta-access",
  identity: { distinctId: "test-user", plan: "pro" },
  kind: "boolean",
  signal: new AbortController().signal,
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
const anonymousConfig: AnonymousGatedConfig<TestIdentity> = {
  anonymous: "allow",
  decide: (_key, identity) => decisions.boolean(identity === null),
  identify: () => null,
}
const invalidAnonymousConfig: AnonymousGatedConfig<TestIdentity> = {
  anonymous: "allow",
  // @ts-expect-error -- Anonymous providers must handle a null identity.
  decide: (_key, identity: TestIdentity) => decisions.boolean(identity.plan === "pro"),
  identify: () => null,
}
const invalidAnonymousGate = buildGate<TestIdentity>({
  anonymous: "allow",
  // @ts-expect-error -- buildGate anonymous overloads require providers to accept null identity.
  decide: (_key, identity: TestIdentity) => decisions.boolean(identity.plan === "pro"),
  identify: () => null,
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

test("exports consumer-facing root types", async () => {
  // @ts-expect-error -- HookContext no longer accepts an options type argument.
  const legacyContext: HookContext<TestIdentity, { custom: boolean }> = hookContext
  const details: EvaluationDetails<boolean> = await evaluator.details()
  const callOptions = {
    identity: hookContext.identity ?? undefined,
  } satisfies GateCallOptions<TestIdentity>
  const overriddenValue = await evaluator(callOptions)
  const assertLegacyEvaluationIsRejected = () => {
    // @ts-expect-error -- Weak-type excess-property checking rejects a bare identity.
    void evaluator({ distinctId: "legacy-user", plan: "pro" })
  }
  // @ts-expect-error -- Decision now requires an explicit type discriminant.
  const legacyDecision: Decision = { value: true }

  expect(afterMeta.source).toBe("provider")
  expect(hookAfterMeta.resolver).toBe(hook)
  expect(hookErrorReport.context).toBe(hookContext)
  expect(invalidHookAfterMeta.source).toBe("hook")
  expect(typeof invalidAnonymousGate).toBe("function")
  expect(identityValue).toEqual({ plan: "pro" })
  expect(maybeDecision).toBe(decision)
  expect(typeof evaluator).toBe("function")
  expect(typeof variantEvaluator).toBe("function")
  expect(details.value).toBe(true)
  expect(typeof assertLegacyEvaluationIsRejected).toBe("function")
  expect(legacyContext).toBe(hookContext)
  expect(readGateConfiguration(hookContext)).toEqual({ defaultValue: false, variants: undefined })
  expect(overriddenValue).toBe(true)
  expect(new IdentityNotFoundError()).toBeInstanceOf(GatedError)
  expect(
    new DecisionTypeMismatchError("boolean", { type: "variant", variant: "dark" })
  ).toBeInstanceOf(GatedError)
  expect(new GateTimeoutError(10).timeoutMs).toBe(10)
  expect(new InvalidVariantError("purple", ["light", "dark"])).toBeInstanceOf(GatedError)
  expect(new MalformedDecisionError({}, "missing type")).toBeInstanceOf(GatedError)
  expect(decisions.boolean(true).value).toBe(true)
  expect(decisions.variant("dark").variant).toBe("dark")
  expect(decisions.boolean(true)).toEqual({ type: "boolean", value: true })
  expect(decisions.variant("dark", { experiment: "theme" })).toEqual({
    payload: { experiment: "theme" },
    type: "variant",
    variant: "dark",
  })
  expect(decisions.variant("dark")).toEqual({ type: "variant", variant: "dark" })
  expect("payload" in decisions.variant("dark")).toBe(false)
  expect(legacyDecision).toHaveProperty("value", true)
  expect(anonymousConfig.anonymous).toBe("allow")
  expect(invalidAnonymousConfig.anonymous).toBe("allow")
})
