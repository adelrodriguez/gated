import type { Decision, EvaluationDetails, GateCallOptions, Identity } from "../types"
import type { AnyGatedConfig, GateOptions } from "./shared"
import { DuplicateBatchKeyError } from "../errors"
import { normalizeError } from "../utils"
import { executeGateDetails, type IdentityResult } from "./engine"
import { evaluateConfiguredDecision, evaluateConfiguredMany, identify } from "./identity"
import { createEvaluationRuntime, type EvaluationRuntime } from "./runtime"
import { createEvaluationSignal, raceWithSignal } from "./signals"

export type BatchEntry = {
  flag: object
  options: GateOptions<string[]>
}

/**
 * One `decideMany` call shared by every evaluation that needed provider work in the same tick.
 * Entries join the open round; the round closes when its timer fires, so evaluations that resolve
 * from cache never delay or join it.
 */
type FlushRound = {
  keys: string[]
  promise: Promise<Record<string, Decision>>
  reject: (error: Error) => void
  resolve: (decisions: Record<string, Decision>) => void
  timer: ReturnType<typeof setTimeout>
}

export async function executeGateBatch<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  entries: readonly BatchEntry[],
  callOptions?: GateCallOptions<TIdentity | null>,
  runtime: EvaluationRuntime = createEvaluationRuntime()
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

  const effectiveTimeouts = entries.map((entry) => entry.options.timeoutMs ?? config.timeoutMs)
  const batchTimeoutMs = effectiveTimeouts.includes(undefined)
    ? undefined
    : Math.max(...(effectiveTimeouts as number[]))
  const batchTimeout = createEvaluationSignal(callOptions?.signal, batchTimeoutMs)
  const batchController = new AbortController()
  const signal = AbortSignal.any([batchTimeout.signal, batchController.signal])
  const entrySignals = new Map(
    entries.map((entry) => [
      entry.flag,
      createEvaluationSignal(callOptions?.signal, entry.options.timeoutMs ?? config.timeoutMs),
    ])
  )
  let identityResult: IdentityResult<TIdentity>
  try {
    const identity = await raceWithSignal(
      () => identify(config.identify, callOptions?.identity, config.anonymous === "allow"),
      signal
    )
    identityResult = { value: identity }
  } catch (error) {
    identityResult = { error: normalizeError(error) }
  }

  let round: FlushRound | undefined

  const flushRound = async (current: FlushRound): Promise<void> => {
    round = undefined
    if ("error" in identityResult) {
      current.reject(identityResult.error)
      return
    }
    const identity = identityResult.value
    try {
      current.resolve(
        await raceWithSignal(
          () => evaluateConfiguredMany(config, current.keys, identity, signal),
          signal
        )
      )
    } catch (error) {
      current.reject(normalizeError(error))
    }
  }

  const joinFlushRound = (key: string): Promise<Record<string, Decision>> => {
    if (!round) {
      const { promise, reject, resolve } = Promise.withResolvers<Record<string, Decision>>()
      void promise.catch(() => null)
      const current: FlushRound = {
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

  const evaluations = entries.map((entry) => {
    const entrySignal = entrySignals.get(entry.flag)
    const provider = async (): Promise<Decision> => {
      if ("error" in identityResult) {
        throw identityResult.error
      }
      const decisions = await joinFlushRound(entry.options.key)
      const batched = Object.hasOwn(decisions, entry.options.key)
        ? decisions[entry.options.key]
        : undefined
      if (batched) {
        return batched
      }
      return await evaluateConfiguredDecision(
        config,
        entry.options.key,
        identityResult.value,
        entrySignal?.signal ?? signal
      )
    }
    return {
      evaluation: executeGateDetails(
        config,
        entry.options,
        { ...callOptions, signal: entrySignal?.signal },
        { identityResult, provider },
        runtime
      ).finally(() => {
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
