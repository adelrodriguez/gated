import type {
  Decision,
  GateEvaluator,
  GateFactory,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
  MaybePromise,
} from "gated"
import { buildGate } from "gated"

interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

declare const config: GatedConfig<ConsumerIdentity>
declare const decision: Decision
declare const hook: Hook<ConsumerIdentity>
declare const hookContext: HookContext<ConsumerIdentity>

const factory: GateFactory<ConsumerIdentity> = buildGate(config)
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
void decision
void hook
void hookContext
void maybeDecision
void (null as unknown as InvalidIdentityEvaluator)
void (null as unknown as InvalidValueEvaluator)
void variantGate
