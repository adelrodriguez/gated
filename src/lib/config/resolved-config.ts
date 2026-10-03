import type {
  AnyGatedConfig,
  Decision,
  DecisionCache,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
} from "#lib/types"
import { IdentityNotFoundError } from "#lib/shared/errors"
import { type ChangeBroadcaster, createChangeBroadcaster } from "./change-broadcaster"
import { createResolutionState, type ResolutionState } from "./resolution-state"

/**
 * One gate factory's configuration with the strict/anonymous/caller-identity union resolved away.
 * Identity resolution and decisions are total functions with the anonymous rule baked in at
 * construction, so no internal module re-branches on the config shape. `AnyGatedConfig` survives
 * only at the `buildGate` boundary.
 */
export type ResolvedConfig<TIdentity extends Identity> = {
  resolveIdentity(override?: TIdentity | null): Promise<TIdentity | null>
  decide(
    key: string,
    identity: TIdentity | null,
    options: { signal: AbortSignal }
  ): Promise<Decision>
  decideMany?: (
    keys: readonly string[],
    identity: TIdentity | null,
    options: { signal: AbortSignal }
  ) => Promise<Record<string, Decision>>
  cache?: DecisionCache
  /**
   * Present only when the config supplies `subscribe`. The only path to the provider signal.
   */
  changes?: ChangeBroadcaster
  coalesce: boolean
  evaluationKey?: (context: HookContext<TIdentity>) => string
  /**
   * Snapshot taken at resolution: mutating the source config's `hooks` array after `buildGate` does
   * not affect evaluations.
   */
  hooks: Array<Hook<TIdentity>>
  state: ResolutionState
  timeoutMs?: number
  onHookError?: GatedConfig<TIdentity>["onHookError"]
  onCacheError?: GatedConfig<TIdentity>["onCacheError"]
}

export function resolveConfig<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>
): ResolvedConfig<TIdentity> {
  const base = {
    cache: config.cache,
    changes: config.subscribe && createChangeBroadcaster(config.subscribe),
    coalesce: config.coalesce !== false,
    evaluationKey: config.evaluationKey,
    hooks: [...(config.hooks ?? [])],
    onCacheError: config.onCacheError,
    onHookError: config.onHookError,
    state: createResolutionState(),
    timeoutMs: config.timeoutMs,
  }

  if (config.anonymous === "allow") {
    const { decide, decideMany, identify } = config
    return {
      ...base,
      decide: async (key, identity, options) => await decide(key, identity, options),
      decideMany:
        decideMany
        && (async (keys, identity, options) => await decideMany(keys, identity, options)),
      resolveIdentity: async (override) => {
        if (override !== undefined) {
          return override
        }
        return (await identify()) ?? null
      },
    }
  }

  const { decide, decideMany, identify } = config
  return {
    ...base,
    decide: async (key, identity, options) => {
      if (identity === null) {
        throw new IdentityNotFoundError()
      }
      return await decide(key, identity, options)
    },
    decideMany:
      decideMany
      && (async (keys, identity, options) => {
        if (identity === null) {
          throw new IdentityNotFoundError()
        }
        return await decideMany(keys, identity, options)
      }),
    resolveIdentity: async (override) => {
      if (override !== undefined) {
        if (override === null) {
          throw new IdentityNotFoundError()
        }
        return override
      }
      if (!identify) {
        throw new IdentityNotFoundError()
      }
      const identity = await identify()
      if (!identity) {
        throw new IdentityNotFoundError()
      }
      return identity
    },
  }
}
