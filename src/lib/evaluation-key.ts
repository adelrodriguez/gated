export function getDefaultEvaluationKey(flagKey: string, distinctId: string | number): string {
  return JSON.stringify([flagKey, typeof distinctId, String(distinctId)])
}
