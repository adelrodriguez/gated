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

export async function coalesceProviderDecision<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  pending: CoalescingState,
  context: HookContext<TIdentity>,
  onPrepared: (providerRequired: boolean) => void,
  provider: () => Decision | Promise<Decision>,
  signal: AbortSignal
): Promise<Decision> {
  const options = getCoalescingOptions(config)
  if (!options) {
    onPrepared(true)
    return await provider()
  }

  const key = getEvaluationKey(context, options.key)
  if (key === undefined) {
    onPrepared(true)
    return await provider()
  }

  const existing = pending.get(key)
  if (existing) {
    onPrepared(false)
    return await raceWithSignal(() => existing.promise, signal)
  }

  const request = Promise.withResolvers<Decision>()
  const leader: PendingDecision = {
    promise: request.promise,
    reject: request.reject,
    resolve: request.resolve,
  }
  void leader.promise.catch(() => null)
  pending.set(key, leader)
  onPrepared(true)

  try {
    const decision = await raceWithSignal(provider, signal)
    leader.resolve(decision)
    return decision
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
