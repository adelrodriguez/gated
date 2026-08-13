import type { GateCallOptions, GateChanges } from "../types"

export type EvaluatorFactoryRef = {
  batch: (flags: readonly object[], callOptions?: GateCallOptions<never>) => Promise<unknown>
  changes: GateChanges
}

const flagKeysByEvaluator = new WeakMap<object, string>()
const factoryRefsByEvaluator = new WeakMap<object, EvaluatorFactoryRef>()

export function getEvaluatorFactoryRef(evaluator: object): EvaluatorFactoryRef | undefined {
  return factoryRefsByEvaluator.get(evaluator)
}

export function getEvaluatorFlagKey(evaluator: object): string | undefined {
  return flagKeysByEvaluator.get(evaluator)
}

export function setEvaluatorFlagKey(evaluator: object, flagKey: string): void {
  flagKeysByEvaluator.set(evaluator, flagKey)
}

export function setEvaluatorFactoryRef(evaluator: object, ref: EvaluatorFactoryRef): void {
  factoryRefsByEvaluator.set(evaluator, ref)
}
