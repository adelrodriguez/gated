export { buildGate } from "./core"
export type { GateFactory } from "./core"
export { decision } from "./lib/decision"
export { createHook } from "./hooks"
export {
  DecisionTypeMismatchError,
  GatedError,
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
} from "./lib/errors"
export type {
  AfterHookMeta,
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
