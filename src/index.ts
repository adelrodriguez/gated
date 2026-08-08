export { buildGate } from "./core"
export type { GateFactory } from "./core"
export { createHook, HookResolutionAbortError } from "./hooks"
export type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  GateEvaluator,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
  MaybePromise,
} from "./lib/types"
