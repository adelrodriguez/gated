import { executeGate } from "./lib"
import type { GatedConfig, Identity } from "./lib/types"

/**
 * A builder function that creates a gated function to evaluate feature flags
 * for a given identity.
 *
 * @example
 *
 * const providerGate = buildGate({
 *   identify: () => getUserId(), // Function to identify the user
 *   decide: (key, identity) => yourProvider.isFeatureEnabled(key, identity), // Provider specific implementation to evaluate the flag
 *   hooks: [
 *     // add hooks here
 *   ],
 * })
 * const betaAccess = providerGate("flag1", false)
 *
 * await betaAccess() // false
 * await betaAccess({ override: true }) // true
 * await betaAccess({ identity: "test-user" }) // evaluate for specific user
 *
 * // Or
 *
 * const themeName = providerGate("theme", "light", ["light", "dark", "system"])
 *
 * const result = await themeName() // "result" is type-safe and can be "light", "dark", or "system"
 */
export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity>
) {
  function gate(options: {
    key: string
    defaultValue: boolean
  }): (overrideIdentity?: TIdentity) => Promise<boolean>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
  }): (overrideIdentity?: TIdentity) => Promise<T[number]>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
  }): (overrideIdentity?: TIdentity) => Promise<boolean | T[number]> {
    return async (overrideIdentity) =>
      executeGate(config, options, overrideIdentity)
  }

  return gate
}
