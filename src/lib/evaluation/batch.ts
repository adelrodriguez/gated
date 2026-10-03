import type { ResolvedConfig } from "#lib/config/resolved-config"
import type {
  Decision,
  EvaluationDetails,
  GateCallOptions,
  GateOptions,
  Identity,
} from "#lib/types"
import { DuplicateBatchKeyError } from "#lib/shared/errors"
import { createEvaluationSignal, raceWithSignal } from "#lib/shared/signals"
import { normalizeError } from "#lib/shared/utils"
import { executeGateDetails, type GateSource } from "./engine"

export type BatchEntry = {
  flag: object
  options: GateOptions<string[]>
}

/**
 * One `decideMany` call shared by every evaluation that needed provider work in the same tick.
 * Entries join the open round; the round closes when its timer fires, so evaluations that resolve
 * from cache never delay or join it.
 */
type FlushRound<TIdentity extends Identity> = {
  identity: TIdentity | null
  keys: string[]
  promise: Promise<Record<string, Decision>>
  reject: (error: Error) => void
  resolve: (decisions: Record<string, Decision>) => void
  timer: ReturnType<typeof setTimeout>
}

export async function executeGateBatch<TIdentity extends Identity>(
  config: ResolvedConfig<TIdentity>,
  entries: readonly BatchEntry[],
  callOptions?: GateCallOptions<TIdentity | null>
): Promise<Map<object, EvaluationDetails<boolean | string>>> {
  if (entries.length === 0) {
    return new Map()
  }

  const duplicateKey = entries
    .map((entry) => entry.options.key)
    .find((key, index, keys) => keys.indexOf(key) !== index)
  if (duplicateKey !== undefined) {
    throw new DuplicateBatchKeyError(duplicateKey)
  }

  const entryTimeouts = new Map(
    entries.map((entry) => [entry.flag, entry.options.timeoutMs ?? config.timeoutMs])
  )
  const effectiveTimeouts = [...entryTimeouts.values()]
  const batchTimeoutMs = effectiveTimeouts.includes(undefined)
    ? undefined
    : Math.max(...(effectiveTimeouts as number[]))
  const batchTimeout = createEvaluationSignal(callOptions?.signal, batchTimeoutMs)
  const batchController = new AbortController()
  const signal = AbortSignal.any([batchTimeout.signal, batchController.signal])
  const entrySignals = new Map(
    entries.map((entry) => [
      entry.flag,
      createEvaluationSignal(callOptions?.signal, entryTimeouts.get(entry.flag)),
    ])
  )

  // Resolve the identity once. Every evaluation in the batch gets this identity, or this error.
  let resolveIdentity: GateSource<TIdentity>["resolveIdentity"]
  try {
    const identity = await raceWithSignal(
      () => config.resolveIdentity(callOptions?.identity),
      signal
    )
    resolveIdentity = () => Promise.resolve(identity)
  } catch (error) {
    const identityError = normalizeError(error)
    resolveIdentity = () => Promise.reject(identityError)
  }

  let round: FlushRound<TIdentity> | undefined

  const flushRound = async (current: FlushRound<TIdentity>): Promise<void> => {
    round = undefined
    try {
      current.resolve(
        await raceWithSignal(
          () => config.decideMany?.(current.keys, current.identity, { signal }) ?? {},
          signal
        )
      )
    } catch (error) {
      current.reject(normalizeError(error))
    }
  }

  const joinFlushRound = (
    key: string,
    identity: TIdentity | null
  ): Promise<Record<string, Decision>> => {
    if (!round) {
      const { promise, reject, resolve } = Promise.withResolvers<Record<string, Decision>>()
      void promise.catch(() => null)
      const current: FlushRound<TIdentity> = {
        identity,
        keys: [],
        promise,
        reject,
        resolve,
        timer: setTimeout(() => {
          void flushRound(current)
        }, 0),
      }
      round = current
    }
    round.keys.push(key)
    return round.promise
  }

  // An evaluation calls `decide` only when it needs provider work: after a cache miss, and never as
  // a coalesced follower. Those evaluations share one `decideMany` call for each flush round.
  const source: GateSource<TIdentity> = {
    async decide(key, identity, options) {
      const decisions = await joinFlushRound(key, identity)
      const batched = Object.hasOwn(decisions, key) ? decisions[key] : undefined
      if (batched) {
        return batched
      }
      return await config.decide(key, identity, options)
    },
    resolveIdentity,
  }

  const evaluations = entries.map((entry) => {
    const entrySignal = entrySignals.get(entry.flag)
    return {
      evaluation: executeGateDetails(config, entry.options, callOptions, source, {
        signal: entrySignal?.signal ?? signal,
      }).finally(() => {
        entrySignal?.cleanup()
      }),
      flag: entry.flag,
    }
  })

  try {
    const settled = await Promise.all(
      evaluations.map(async ({ evaluation, flag }) => ({
        details: await evaluation,
        flag,
      }))
    )
    return new Map(settled.map(({ details, flag }) => [flag, details]))
  } finally {
    if (round) {
      clearTimeout(round.timer)
    }
    batchController.abort()
    batchTimeout.cleanup()
  }
}
