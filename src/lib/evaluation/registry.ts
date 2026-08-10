const flagKeysByEvaluator = new WeakMap<object, string>()

export function getEvaluatorFlagKey(evaluator: object): string | undefined {
  return flagKeysByEvaluator.get(evaluator)
}

export function setEvaluatorFlagKey(evaluator: object, flagKey: string): void {
  flagKeysByEvaluator.set(evaluator, flagKey)
}
