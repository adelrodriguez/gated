export { buildGate } from "./core"
export type { GateFactory } from "./core"
export { createHook } from "./hooks"
export {
  DecisionTypeMismatchError,
  GatedError,
  IdentityNotFoundError,
  InvalidVariantError,
} from "./lib/errors"
export type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateEvaluator,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "./lib/types"
