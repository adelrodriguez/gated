export function getDefaultEvaluationKey(flagKey: string, distinctId: string | number): string {
  return JSON.stringify([flagKey, typeof distinctId, String(distinctId)])
}

export function getDefaultCoalescingKey(
  flagKey: string,
  kind: "boolean" | "variant",
  variants: readonly string[] | undefined,
  distinctId: string | number
): string {
  return JSON.stringify([
    flagKey,
    kind,
    kind === "variant" ? variants : undefined,
    typeof distinctId,
    String(distinctId),
  ])
}
