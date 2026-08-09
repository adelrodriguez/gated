export { buildGate } from "./core"
export type { GateFactory, GateSnapshot } from "./core"
export { decision } from "./lib/decision"
export { defineHook } from "./hooks"
export {
  DecisionTypeMismatchError,
  DuplicateSnapshotKeyError,
  ForeignGateEvaluatorError,
  GatedError,
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  SnapshotFlagNotFoundError,
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
