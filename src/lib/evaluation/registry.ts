import type { GateCallOptions, GateChanges } from "../types"
import type { GateOptions } from "./shared"

export type EvaluatorFactoryRef = {
  batch: (flags: readonly object[], callOptions?: GateCallOptions<never>) => Promise<unknown>
  changes: GateChanges
}

export type EvaluatorRecord = {
  factoryRef: EvaluatorFactoryRef
  options: GateOptions<string[]>
}

const recordsByEvaluator = new WeakMap<object, EvaluatorRecord>()

export function getEvaluatorRecord(evaluator: object): EvaluatorRecord | undefined {
  return recordsByEvaluator.get(evaluator)
}

export function registerEvaluator(evaluator: object, record: EvaluatorRecord): void {
  recordsByEvaluator.set(evaluator, record)
}
