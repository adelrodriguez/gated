const evaluatorFlagKeys = new WeakMap<object, string>()

export function getEvaluatorFlagKey(evaluator: object): string | undefined {
  return evaluatorFlagKeys.get(evaluator)
}

export function setEvaluatorFlagKey(evaluator: object, flagKey: string): void {
  evaluatorFlagKeys.set(evaluator, flagKey)
}
