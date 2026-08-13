export { buildGate } from "./factory"
export type { GateFactory, GateBatch } from "./factory"
export { decision } from "./decision"
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
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  Decision,
  DecisionCache,
  DecisionCacheErrorReport,
  DecisionSource,
  EvaluationDetails,
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
