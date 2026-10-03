import type { HookContext, Identity } from "#lib/types"

export function getEvaluationKey<TIdentity extends Identity>(
  context: HookContext<TIdentity>,
  key?: (context: HookContext<TIdentity>) => string
): string | undefined {
  if (!context.identity) {
    return undefined
  }
  if (key) {
    return key(context)
  }
  const { distinctId } = context.identity
  return JSON.stringify([
    context.flagKey,
    context.kind,
    context.variants,
    typeof distinctId,
    String(distinctId),
  ])
}
