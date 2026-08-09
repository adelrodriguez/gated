import type {
  AfterHookMeta,
  AnonymousGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateEvaluator,
  GateFactory,
  GateSnapshot,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "gated"
import {
  buildGate,
  DecisionTypeMismatchError,
  DuplicateSnapshotKeyError,
  ForeignGateEvaluatorError,
  GateTimeoutError,
  GatedError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  SnapshotFlagNotFoundError,
  decision as decisions,
} from "gated"

interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

declare const config: GatedConfig<ConsumerIdentity>
declare const anonymousConfig: AnonymousGatedConfig<ConsumerIdentity>
declare const decision: Decision
declare const hook: Hook<ConsumerIdentity>
declare const hookContext: HookContext<ConsumerIdentity>

const decisionSource: DecisionSource = "provider"
const factory: GateFactory<ConsumerIdentity> = buildGate(config)
const identityError: GatedError = new IdentityNotFoundError()
const mismatchError: GatedError = new DecisionTypeMismatchError("boolean", {
  type: "variant",
  variant: "dark",
})
const timeoutError: GatedError = new GateTimeoutError(100)
const duplicateSnapshotKeyError: GatedError = new DuplicateSnapshotKeyError("theme")
const foreignGateEvaluatorError: GatedError = new ForeignGateEvaluatorError()
const snapshotFlagNotFoundError: GatedError = new SnapshotFlagNotFoundError()
const variantError: GatedError = new InvalidVariantError("purple", ["light", "dark"])
const malformedError: GatedError = new MalformedDecisionError({}, "missing type")
const constructedBooleanValue: boolean = decisions.boolean(true).value
const constructedVariantValue: string = decisions.variant("dark").variant
const afterMeta: AfterHookMeta<ConsumerIdentity> = { source: decisionSource }
const hookAfterMeta: AfterHookMeta<ConsumerIdentity> = { resolver: hook, source: "hook" }
// @ts-expect-error hook-resolved metadata requires the exact resolver
const invalidHookAfterMeta: AfterHookMeta<ConsumerIdentity> = { source: "hook" }
const hookErrorReport: HookErrorReport<ConsumerIdentity> = {
  context: hookContext,
  error: new Error("Hook failed"),
  hookIndex: 0,
  phase: "before",
}
const maybeDecision: MaybePromise<Decision> = decision
const identityValue: IdentityValue = { plan: "pro" }
const booleanGate: GateEvaluator<ConsumerIdentity, boolean> = factory({
  defaultValue: false,
  key: "beta-access",
})
const variantGate: GateEvaluator<ConsumerIdentity, "dark" | "light"> = factory({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})
const snapshotPromise: Promise<GateSnapshot<readonly [typeof booleanGate, typeof variantGate]>> =
  factory.snapshot([booleanGate, variantGate])
declare const snapshot: GateSnapshot<readonly [typeof booleanGate, typeof variantGate]>
const snapshotBooleanValue: boolean = snapshot.get(booleanGate)
const snapshotVariantValue: "dark" | "light" = snapshot.get(variantGate)
const snapshotVariantDetails: EvaluationDetails<"dark" | "light"> = snapshot.details(variantGate)

// @ts-expect-error evaluator identities must satisfy the public Identity contract
type InvalidIdentityEvaluator = GateEvaluator<string, boolean>
// @ts-expect-error evaluators only return supported gate values
type InvalidValueEvaluator = GateEvaluator<ConsumerIdentity, symbol>

void booleanGate
void anonymousConfig
void constructedBooleanValue
void constructedVariantValue
void afterMeta
void decision
void duplicateSnapshotKeyError
void foreignGateEvaluatorError
void hook
void hookAfterMeta
void hookContext
void hookErrorReport
void identityError
void identityValue
void invalidHookAfterMeta
void malformedError
void mismatchError
void maybeDecision
void timeoutError
void snapshotBooleanValue
void snapshotFlagNotFoundError
void snapshotPromise
void snapshotVariantDetails
void snapshotVariantValue
void (null as never as InvalidIdentityEvaluator)
void (null as never as InvalidValueEvaluator)
void variantError
void variantGate
