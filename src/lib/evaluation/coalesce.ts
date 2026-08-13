import type { CoalescingOptions, Decision, HookContext, Identity } from "../types"
import { normalizeError } from "../utils"
import { type AnyGatedConfig, getEvaluationKey } from "./shared"
import { raceWithSignal } from "./signals"

type PendingDecision = {
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

export type CoalescingState = Map<string, PendingDecision>

export function createCoalescingState(): CoalescingState {
  return new Map()
}

function getCoalescingOptions<TIdentity extends Identity>(
  config: Pick<AnyGatedConfig<TIdentity>, "coalesce">
): CoalescingOptions<TIdentity> | undefined {
  const option = config.coalesce
  if (option === true) {
    return {}
  }
  if (option === false || option === undefined) {
    return undefined
  }
  return option
}

/**
 * The provider decision plus whether this evaluation owned the provider call. Followers of a
 * coalesced call share the leader's decision but must not act as if they produced it (e.g. by
 * writing it back to a cache).
 */
export type CoalescedDecision = {
  decision: Decision
  owned: boolean
}

export async function coalesceProviderDecision<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  pending: CoalescingState,
  context: HookContext<TIdentity>,
  provider: () => Decision | Promise<Decision>,
  signal: AbortSignal
): Promise<CoalescedDecision> {
  const options = getCoalescingOptions(config)
  if (!options) {
    return { decision: await raceWithSignal(provider, signal), owned: true }
  }

  const key = getEvaluationKey(context, options.key)
  if (key === undefined) {
    return { decision: await raceWithSignal(provider, signal), owned: true }
  }

  const existing = pending.get(key)
  if (existing) {
    return { decision: await raceWithSignal(() => existing.promise, signal), owned: false }
  }

  const request = Promise.withResolvers<Decision>()
  const leader: PendingDecision = {
    promise: request.promise,
    reject: request.reject,
    resolve: request.resolve,
  }
  void leader.promise.catch(() => null)
  pending.set(key, leader)

  try {
    const decision = await raceWithSignal(provider, signal)
    leader.resolve(decision)
    return { decision, owned: true }
  } catch (error) {
    const providerError = normalizeError(error)
    leader.reject(providerError)
    throw providerError
  } finally {
    if (pending.get(key) === leader) {
      pending.delete(key)
    }
  }
}
