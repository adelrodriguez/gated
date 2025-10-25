import { type ReactNode, Suspense, use } from "react"
import type { Identity } from "../lib/types"

/**
 * Wraps an async gate function to work as a React hook using React.use()
 *
 * @example
 * ```typescript
 * import { buildGate } from "gated"
 * import { createReactHook } from "gated/react"
 *
 * const gate = buildGate({
 *   identify: async () => ({ distinctId: userId }),
 *   decide: async (key, identity) => api.evaluateFlag(key, identity),
 *   hooks: [cacheHook(cache)],
 * })
 *
 * const betaAccess = gate({ key: "beta-access", defaultValue: false })
 * export const useBetaAccess = createReactHook(betaAccess)
 *
 * const themeFlag = gate({
 *   key: "theme",
 *   defaultValue: "light",
 *   variants: ["light", "dark", "system"],
 * })
 * export const useTheme = createReactHook(themeFlag)
 *
 * // In component:
 * function MyComponent() {
 *   const isBeta = useBetaAccess()
 *   const theme = useTheme()
 *   return <div className={theme}>{isBeta && <BetaFeature />}</div>
 * }
 * ```
 */
export function createReactHook<
  TIdentity extends Identity,
  TValue extends boolean | string,
>(
  gateFn: (overrideIdentity?: TIdentity) => Promise<TValue>
): (overrideIdentity?: TIdentity) => TValue {
  function useGateValue(overrideIdentity?: TIdentity): TValue {
    return use(gateFn(overrideIdentity))
  }

  return useGateValue
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
