import type { GateEvaluator, GatedConfig, Identity } from "./lib/types"
import { executeGate } from "./lib"

export interface GateFactory<TIdentity extends Identity> {
  (options: { key: string; defaultValue: boolean }): GateEvaluator<TIdentity, boolean>
  <const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
  }): GateEvaluator<TIdentity, T[number]>
}

/**
 * A builder function that creates a gated function to evaluate feature flags for a given identity.
 *
 * @example
 *   const gate = buildGate({
 *     identify: async () => ({ distinctId: getCurrentUserId() }),
 *     decide: async (key, identity) => yourProvider.evaluate(key, identity),
 *   })
 *
 *   const betaAccess = gate({ key: "beta-access", defaultValue: false })
 *
 *   await betaAccess()
 *   await betaAccess({ distinctId: "test-user" }) // Evaluate for a specific identity
 *
 *   const theme = gate({
 *     key: "theme",
 *     defaultValue: "light",
 *     variants: ["light", "dark", "system"],
 *   })
 *
 *   const result = await theme() // "light" | "dark" | "system"
 */
export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity>
): GateFactory<TIdentity> {
  function gate(options: { key: string; defaultValue: boolean }): GateEvaluator<TIdentity, boolean>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
  }): GateEvaluator<TIdentity, T[number]>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
  }): GateEvaluator<TIdentity, boolean | T[number]> {
    return async (overrideIdentity) => executeGate(config, options, overrideIdentity)
  }

  return gate
}
