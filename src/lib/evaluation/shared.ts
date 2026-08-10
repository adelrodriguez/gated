import type {
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  GatedConfig,
  HookContext,
  Identity,
} from "../types"

export type AnyGatedConfig<TIdentity extends Identity> =
  | GatedConfig<TIdentity>
  | AnonymousGatedConfig<TIdentity>
  | CallerIdentityGatedConfig<TIdentity>

export type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
  timeoutMs?: number
}

export type GateConfiguration =
  | { kind: "boolean" }
  | { kind: "variant"; variants: readonly string[] }

export function getGateConfiguration(variants?: readonly string[]): GateConfiguration {
  return variants ? { kind: "variant", variants } : { kind: "boolean" }
}

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
