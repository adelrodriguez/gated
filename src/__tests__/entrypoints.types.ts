import type {
  AnonymousGatedConfig,
  DecisionCache,
  DecisionCacheErrorReport,
  CallerIdentityGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateChange,
  GateEvaluator,
  GateFactory,
  GateBatch,
  GateChanges,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
  GatedError,
} from "../index"
import type {
  CreateReactGateOptions,
  ReactGate,
  ReactGateCache,
  ReactGateCacheKey,
  ReactGateCacheOptions,
} from "../integrations/react"
import { defineHook } from "../hooks"
import {
  buildGate,
  DecisionTypeMismatchError,
  DuplicateBatchKeyError,
  ForeignGateEvaluatorError,
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  BatchFlagNotFoundError,
  decision as decisions,
} from "../index"
import {
  createReactGate,
  createReactGateCache,
  FeatureGate,
  GateCacheProvider,
} from "../integrations/react"

interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

declare const config: GatedConfig<ConsumerIdentity>
declare const anonymousConfig: AnonymousGatedConfig<ConsumerIdentity>
declare const callerIdentityConfig: CallerIdentityGatedConfig<ConsumerIdentity>
declare const decision: Decision
declare const hook: Hook<ConsumerIdentity>
declare const hookContext: HookContext<ConsumerIdentity>
declare const annotatedVariantGate: GateEvaluator<
  ConsumerIdentity,
  "dark" | "light",
  ConsumerIdentity,
  { experiment: string }
>

const decisionSource: DecisionSource = "provider"
declare const cache: DecisionCache
const factory: GateFactory<ConsumerIdentity> = buildGate(config)
const anonymousFactory: GateFactory<ConsumerIdentity, ConsumerIdentity | null> =
  buildGate(anonymousConfig)
const callerIdentityFactory = buildGate(callerIdentityConfig)
const identityError: GatedError = new IdentityNotFoundError()
const mismatchError: GatedError = new DecisionTypeMismatchError("boolean", {
  type: "variant",
  variant: "dark",
})
const timeoutError: GatedError = new GateTimeoutError(100)
const duplicateBatchKeyError: GatedError = new DuplicateBatchKeyError("theme")
const foreignGateEvaluatorError: GatedError = new ForeignGateEvaluatorError()
const batchFlagNotFoundError: GatedError = new BatchFlagNotFoundError()
const variantError: GatedError = new InvalidVariantError("purple", ["light", "dark"])
const malformedError: GatedError = new MalformedDecisionError({}, "missing type")
const constructedBooleanValue: boolean = decisions.boolean(true).value
const constructedVariantValue: string = decisions.variant("dark").variant
const hookErrorReport: HookErrorReport<ConsumerIdentity> = {
  context: hookContext,
  error: new Error("Hook failed"),
  hookIndex: 0,
  phase: "before",
}

const maybeDecision: MaybePromise<Decision> = decision
const identityValue: IdentityValue = { plan: "pro" }
const evaluationKey: GatedConfig<ConsumerIdentity>["evaluationKey"] = (context) =>
  String(context.identity?.plan)
const configuredCache: GatedConfig<ConsumerIdentity>["cache"] = cache
const cacheErrorReport: DecisionCacheErrorReport<ConsumerIdentity> = {
  error: new Error("DecisionCache failed"),
  flagKey: "beta-access",
  identity: { distinctId: "user123", plan: "pro" },
  key: "cache-key",
  operation: "get",
}
const providerChange: GateChange = { keys: ["beta-access"] }
const booleanGate: GateEvaluator<ConsumerIdentity, boolean> = factory({
  defaultValue: false,
  key: "beta-access",
})
const reactCacheOptions: ReactGateCacheOptions = { pendingTtlMs: 1000 }
const reactCache: ReactGateCache<boolean> = createReactGateCache<boolean>(reactCacheOptions)
const reactGateOptions: CreateReactGateOptions<boolean> = { cache: reactCache }
const reactGate: ReactGate<ConsumerIdentity, boolean> = createReactGate(
  booleanGate,
  reactGateOptions
)
const reactCacheKey: ReactGateCacheKey = { distinctId: "user123" }
const gateChanges: GateChanges = factory.changes
const detachChangeListener = gateChanges.subscribe((keys) => {
  void keys
})
const variantGate: GateEvaluator<ConsumerIdentity, "dark" | "light"> = factory({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})
const typedVariantGate = factory<{ experiment: string }>({
  defaultValue: "light",
  key: "typed-theme",
  variants: ["light", "dark"],
})
const anonymousBooleanGate = anonymousFactory({
  defaultValue: false,
  key: "anonymous-beta-access",
})
const callerIdentityBooleanGate = callerIdentityFactory({
  defaultValue: false,
  key: "caller-beta-access",
})
void callerIdentityBooleanGate({ identity: { distinctId: "user123", plan: "pro" } })
void callerIdentityBooleanGate.details({ identity: { distinctId: "user123", plan: "pro" } })
void callerIdentityFactory.batch([callerIdentityBooleanGate], {
  identity: { distinctId: "user123", plan: "pro" },
})
// @ts-expect-error -- Caller-identity evaluators require call options with an identity.
void callerIdentityBooleanGate()
// @ts-expect-error -- Caller-identity details require call options with an identity.
void callerIdentityBooleanGate.details()
// @ts-expect-error -- Caller-identity batches require call options with an identity.
void callerIdentityFactory.batch([callerIdentityBooleanGate])
void anonymousBooleanGate({ identity: null })
void anonymousFactory.batch([anonymousBooleanGate], { identity: null })
// @ts-expect-error -- Strict evaluators do not accept an explicit anonymous identity.
void booleanGate({ identity: null })
// @ts-expect-error -- Strict batches do not accept an explicit anonymous identity.
void factory.batch([booleanGate], { identity: null })
const batchPromise: Promise<GateBatch<readonly [typeof booleanGate, typeof variantGate]>> =
  factory.batch([booleanGate, variantGate])
declare const batch: GateBatch<readonly [typeof booleanGate, typeof variantGate]>
const batchBooleanValue: boolean = batch.get(booleanGate)
const batchVariantValue: "dark" | "light" = batch.get(variantGate)
const batchVariantDetails: EvaluationDetails<"dark" | "light"> = batch.details(variantGate)
async function assertPayloadTypes(): Promise<void> {
  const annotatedDetails = await annotatedVariantGate.details()
  const annotatedPayload: { experiment: string } | undefined = annotatedDetails.payload
  const typedDetails = await typedVariantGate.details()
  const typedPayload: { experiment: string } | undefined = typedDetails.payload
  const untypedDetails = await variantGate.details()
  const unknownPayload: unknown = untypedDetails.payload
  const booleanDetails = await booleanGate.details()
  // @ts-expect-error -- Boolean-gate evaluation details never contain a variant payload.
  void booleanDetails.payload

  const typedBatch = await factory.batch([booleanGate, typedVariantGate] as const)
  const batchPayload: { experiment: string } | undefined =
    typedBatch.details(typedVariantGate).payload

  void batchPayload
  void annotatedPayload
  void typedPayload
  void unknownPayload
}
type SnapshotApiIsRemoved = "snapshot" extends keyof typeof factory ? never : true
const assertSnapshotApiIsRemoved: SnapshotApiIsRemoved = true

// @ts-expect-error evaluator identities must satisfy the public Identity contract
type InvalidIdentityEvaluator = GateEvaluator<string, boolean>
// @ts-expect-error evaluators only return supported gate values
type InvalidValueEvaluator = GateEvaluator<ConsumerIdentity, symbol>

void booleanGate
void anonymousBooleanGate
void anonymousConfig
void callerIdentityConfig
void annotatedVariantGate
void constructedBooleanValue
void constructedVariantValue
void evaluationKey
void cache
void configuredCache
void cacheErrorReport
void assertSnapshotApiIsRemoved
void assertPayloadTypes
void decision
void decisionSource
void duplicateBatchKeyError
void foreignGateEvaluatorError
void hook
void defineHook

void hookContext
void hookErrorReport
void identityError
void identityValue
void providerChange
void detachChangeListener
void gateChanges
void FeatureGate
void GateCacheProvider

void malformedError
void mismatchError
void maybeDecision
void timeoutError
void reactCache
void reactCacheKey
void reactCacheOptions
void reactGate
void reactGateOptions
void batchBooleanValue
void batchFlagNotFoundError
void batchPromise
void batchVariantDetails
void batchVariantValue
void (null as never as InvalidIdentityEvaluator)
void (null as never as InvalidValueEvaluator)
void variantError
void variantGate
void typedVariantGate
