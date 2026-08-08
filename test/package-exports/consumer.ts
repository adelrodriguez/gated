import type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  GateEvaluator,
  GateFactory,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
  MaybePromise,
} from "gated"
import { buildGate, HookResolutionAbortError } from "gated"
import { HookResolutionAbortError as HookAbortError } from "gated/hooks"

interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

declare const config: GatedConfig<ConsumerIdentity>
declare const decision: Decision
declare const hook: Hook<ConsumerIdentity>
declare const hookContext: HookContext<ConsumerIdentity>

const decisionSource: DecisionSource = "provider"
const factory: GateFactory<ConsumerIdentity> = buildGate(config)
const abortError = new HookResolutionAbortError(new Error("stop resolution"))
const hookAbortError = new HookAbortError(new Error("stop hook resolution"))
const afterMeta: AfterHookMeta<ConsumerIdentity> = { source: decisionSource }
const maybeDecision: MaybePromise<Decision> = decision
const booleanGate: GateEvaluator<ConsumerIdentity, boolean> = factory({
  defaultValue: false,
  key: "beta-access",
})
const variantGate: GateEvaluator<ConsumerIdentity, "dark" | "light"> = factory({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})

// @ts-expect-error evaluator identities must satisfy the public Identity contract
type InvalidIdentityEvaluator = GateEvaluator<string, boolean>
// @ts-expect-error evaluators only return supported gate values
type InvalidValueEvaluator = GateEvaluator<ConsumerIdentity, symbol>

void booleanGate
void afterMeta
void abortError
void decision
void hook
void hookContext
void hookAbortError
void maybeDecision
void (null as unknown as InvalidIdentityEvaluator)
void (null as unknown as InvalidValueEvaluator)
void variantGate
