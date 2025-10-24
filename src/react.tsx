import { type ReactNode, Suspense, use } from "react"
import { executeGate } from "./lib"
import type { GatedConfig, Identity } from "./lib/types"

/**
 * Builds a gated hook function that mirrors the core buildGate pattern.
 *
 * @example
 * ```typescript
 * import { buildGate } from "gated/react"
 *
 * const gate = buildGate({
 *   identify: async () => ({ distinctId: userId }),
 *   decide: async (key, identity) => api.evaluateFlag(key, identity),
 *   hooks: [cacheHook(cache)], // optional
 * })
 *
 * export const useBetaAccess = gate({
 *   key: "beta-access",
 *   defaultValue: false,
 * })
 *
 * export const useTheme = gate({
 *   key: "theme",
 *   defaultValue: "light",
 *   variants: ["light", "dark", "system"],
 * })
 * ```
 *
 */
export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity>
) {
  function gate(options: {
    key: string
    defaultValue: boolean
  }): (overrideIdentity?: TIdentity) => boolean
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
  }): (overrideIdentity?: TIdentity) => T[number]
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
  }): (overrideIdentity?: TIdentity) => boolean | T[number] {
    function useGate(overrideIdentity?: TIdentity) {
      return use(executeGate(config, options, overrideIdentity))
    }

    return useGate
  }

  return gate
}

export function FeatureGate<TIdentity extends Identity>(props: {
  children: ReactNode
  gate: (overrideIdentity?: TIdentity) => boolean
  loading?: ReactNode
  fallback?: ReactNode
  overrideIdentity?: TIdentity
  match?: boolean
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => string,
>(props: {
  children: ReactNode
  gate: TGate
  loading?: ReactNode
  fallback?: ReactNode
  overrideIdentity?: TIdentity
  match: ReturnType<TGate>
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => boolean | string,
>({
  children,
  gate,
  loading,
  fallback,
  overrideIdentity,
  match,
}: React.PropsWithChildren<{
  gate: TGate
  loading?: ReactNode
  fallback?: ReactNode
  overrideIdentity?: TIdentity
  match?: ReturnType<TGate>
}>): ReactNode {
  return (
    <Suspense fallback={loading}>
      {(() => {
        const value = gate(overrideIdentity)
        const matchValue = match ?? true
        return value === matchValue ? children : fallback
      })()}
    </Suspense>
  )
}
