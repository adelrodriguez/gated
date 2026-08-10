export { buildGate } from "./factory"
export type { GateFactory, GateBatch } from "./factory"
export { decision } from "./lib/decision"
export { defineHook } from "./hooks"
export {
  DecisionTypeMismatchError,
  DuplicateBatchKeyError,
  ForeignGateEvaluatorError,
  GatedError,
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  BatchFlagNotFoundError,
} from "./lib/errors"
export type {
  AfterHookMeta,
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  CoalescingOptions,
  Decision,
  DecisionSource,
  EvaluationDetails,
  FallbackReport,
  GateChange,
  GateCallOptions,
  GateChanges,
  GateEvaluator,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "./lib/types"
