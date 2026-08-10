import type { Decision, EvaluationDetails, GateCallOptions, Identity } from "../types"
import type { AnyGatedConfig, GateOptions } from "./shared"
import { DuplicateBatchKeyError } from "../errors"
import { normalizeError } from "../utils"
import { executeGateDetails, type IdentityResult } from "./engine"
import { evaluateConfiguredDecision, evaluateConfiguredMany, identify } from "./identity"
import { createEvaluationSignal, raceWithSignal } from "./signals"

export type BatchEntry = {
  flag: object
  options: GateOptions<string[]>
}

type DecisionRequest = {
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

function createDecisionRequest(): DecisionRequest {
  const { promise, reject, resolve } = Promise.withResolvers<Decision>()
  void promise.catch(() => null)
  return { promise, reject, resolve }
}

export async function executeGateBatch<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
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

  const requests = new Map<object, DecisionRequest>()
  const queued = new Map<object, BatchEntry>()
  let batchTimer: ReturnType<typeof setTimeout> | undefined

  const flushBatch = async (): Promise<void> => {
    batchTimer = undefined
    const unresolved = [...queued.values()]
    queued.clear()
    if (unresolved.length === 0 || !("value" in identityResult)) {
      return
    }

    const identity = identityResult.value
    try {
      const decisions = await raceWithSignal(
        () =>
          evaluateConfiguredMany(
            config,
            unresolved.map((entry) => entry.options.key),
            identity,
            signal
          ),
        signal
      )

      await Promise.all(
        unresolved.map(async (entry) => {
          const request = requests.get(entry.flag)
          if (!request) {
            return
          }
          const batched = Object.hasOwn(decisions, entry.options.key)
            ? decisions[entry.options.key]
            : undefined
          if (batched) {
            request.resolve(batched)
            return
          }
          const entrySignal = entrySignals.get(entry.flag)?.signal ?? signal
          try {
            request.resolve(
              await raceWithSignal(
                () => evaluateConfiguredDecision(config, entry.options.key, identity, entrySignal),
                entrySignal
              )
            )
          } catch (error) {
            request.reject(normalizeError(error))
          }
        })
      )
    } catch (error) {
      for (const entry of unresolved) {
        requests.get(entry.flag)?.reject(normalizeError(error))
      }
    }
  }

  const scheduleBatch = (): void => {
    if (batchTimer !== undefined) {
      return
    }
    batchTimer = setTimeout(() => {
      void flushBatch()
    }, 0)
  }

  const evaluations = entries.map((entry) => {
    const request = createDecisionRequest()
    const entrySignal = entrySignals.get(entry.flag)
    return {
      evaluation: executeGateDetails(
        config,
        entry.options,
        { ...callOptions, signal: entrySignal?.signal },
        {
          identityResult,
          onPrepared(providerRequired) {
            if (providerRequired) {
              requests.set(entry.flag, request)
              queued.set(entry.flag, entry)
              scheduleBatch()
            }
          },
          provider: () => request.promise,
        }
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
    if (batchTimer !== undefined) {
      clearTimeout(batchTimer)
    }
    batchController.abort()
    batchTimeout.cleanup()
  }
}
