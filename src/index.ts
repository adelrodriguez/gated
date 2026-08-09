export { buildGate } from "./core"
export type { GateFactory, GateBatch } from "./core"
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
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateCallOptions,
  GateEvaluator,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "./lib/types"
