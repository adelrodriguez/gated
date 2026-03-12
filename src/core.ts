import type { GatedConfig, Identity } from "./lib/types"
import { executeGate } from "./lib"

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
 * const betaAccess = providerGate({ key: "flag1", defaultValue: false })
 *
 * await betaAccess() // false
 * await betaAccess({ distinctId: "test-user" }) // evaluate for specific user
 *
 * // Or
 *
 * const themeName = providerGate({ key: "theme", defaultValue: "light", variants: ["light", "dark", "system"] })
 *
 * const result = await themeName() // "result" is type-safe and can be "light", "dark", or "system"
 */
type Gate<TIdentity extends Identity> = {
  (options: {
    key: string
    defaultValue: boolean
  }): (overrideIdentity?: TIdentity) => Promise<boolean>
  <const T extends readonly string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
  }): (overrideIdentity?: TIdentity) => Promise<T[number]>
}

export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity>
): Gate<TIdentity> {
  function gate<const T extends readonly string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
  }): (overrideIdentity?: TIdentity) => Promise<boolean | T[number]> {
    return async (overrideIdentity) => executeGate(config, options, overrideIdentity)
  }

  return gate as Gate<TIdentity>
}
