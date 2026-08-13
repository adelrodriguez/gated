import type {
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateCallOptions,
  HookContext,
  Identity,
} from "../types"
import { runAfterHooks, runBeforeHooks, runErrorHooks, runFinallyHooks } from "../hook"
import { normalizeError } from "../utils"
import { consultCache, writeCacheDecision } from "./cache"
import { coalesceProviderDecision } from "./coalesce"
import { extractDecisionValue, validateDecision } from "./decision"
import { evaluateConfiguredDecision, identify } from "./identity"
import { createEvaluationRuntime, type EvaluationRuntime } from "./runtime"
import {
  type AnyGatedConfig,
  type GateConfiguration,
  type GateOptions,
  getGateConfiguration,
} from "./shared"
import { consumeCleanup, createEvaluationSignal, raceWithSignal } from "./signals"

type Evaluation<TIdentity extends Identity> = {
  defaultValue: boolean | string
  decision?: Decision
  key: string
  kind: "boolean" | "variant"
  identity: TIdentity | null
  source: DecisionSource | "default"
  signal: AbortSignal
  variants?: readonly string[]
}

export type IdentityResult<TIdentity extends Identity> =
  | { error: Error }
  | { value: TIdentity | null }

/**
 * Contract between the batch orchestrator and one evaluation.
 *
 * `identityResult` replaces identity resolution. `onPrepared` fires exactly once, before provider
 * work: `true` only when this evaluation owns provider work, and `false` after a cache hit, a
 * pre-provider failure, or when it follows coalesced provider work. `provider` replaces configured
 * `decide` and is not called before `onPrepared(true)`.
 */
export type ExecutionOverrides<TIdentity extends Identity> = {
  identityResult: IdentityResult<TIdentity>
  onPrepared: (providerRequired: boolean) => void
  provider: () => Promise<Decision>
}

function createHookContext<TIdentity extends Identity>(
  evaluation: Evaluation<TIdentity>,
  config: GateConfiguration
): HookContext<TIdentity> {
  const { defaultValue } = evaluation

  if (config.kind === "boolean") {
    if (typeof defaultValue !== "boolean") {
      throw new TypeError("A boolean evaluation requires a boolean default value")
    }
    return {
      defaultValue,
      get flagKey() {
        return evaluation.key
      },
      get identity() {
        return evaluation.identity
      },
      kind: "boolean",
      get signal() {
        return evaluation.signal
      },
      variants: undefined,
    }
  }

  if (typeof defaultValue !== "string") {
    throw new TypeError("A variant evaluation requires a string default value")
  }
  return {
    defaultValue,
    get flagKey() {
      return evaluation.key
    },
    get identity() {
      return evaluation.identity
    },
    kind: "variant",
    get signal() {
      return evaluation.signal
    },
    variants: config.variants,
  }
}

export async function executeGateDetails<
  TIdentity extends Identity,
  T extends string[] = string[],
  TPayload = unknown,
>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity | null>,
  execution?: ExecutionOverrides<TIdentity>,
  runtime: EvaluationRuntime = createEvaluationRuntime()
): Promise<EvaluationDetails<boolean | T[number], TPayload>> {
  const hooks = [...(config.hooks ?? [])]
  const gateConfiguration = getGateConfiguration(options.variants)
  const { cleanup, signal } = createEvaluationSignal(
    callOptions?.signal,
    execution ? undefined : (options.timeoutMs ?? config.timeoutMs)
  )
  const evaluation: Evaluation<TIdentity> = {
    defaultValue: options.defaultValue,
    identity: null,
    key: options.key,
    kind: gateConfiguration.kind,
    signal,
    source: "default",
    variants: gateConfiguration.kind === "variant" ? gateConfiguration.variants : undefined,
  }
  const hookContext = createHookContext(evaluation, gateConfiguration)
  let result: boolean | T[number] | undefined
  let failure: Error | undefined
  let postCommitHooks: Promise<void> | undefined
  const preparation = { providerRequired: false, reported: false }
  const reportPreparation = (providerRequired: boolean): void => {
    if (preparation.reported) {
      throw new Error("Evaluation preparation was reported more than once")
    }
    preparation.reported = true
    execution?.onPrepared(providerRequired)
  }

  try {
    const identity = await raceWithSignal(async () => {
      if (execution?.identityResult && "error" in execution.identityResult) {
        throw execution.identityResult.error
      }
      if (execution?.identityResult && "value" in execution.identityResult) {
        return execution.identityResult.value
      }
      return await identify(config.identify, callOptions?.identity, config.anonymous === "allow")
    }, signal)
    evaluation.identity = identity

    await raceWithSignal(() => runBeforeHooks(hooks, hookContext, config.onHookError), signal)

    const cacheConsultation = await raceWithSignal(
      () => consultCache(config, runtime.cache, hookContext, options),
      signal
    )
    let decision: Decision
    if (cacheConsultation?.decision) {
      reportPreparation(false)
      decision = cacheConsultation.decision
      evaluation.source = "cache"
    } else {
      decision = await raceWithSignal(
        () =>
          coalesceProviderDecision(
            config,
            runtime.coalescing,
            hookContext,
            (required) => {
              preparation.providerRequired = required
              reportPreparation(required)
            },
            () =>
              execution?.provider() ??
              evaluateConfiguredDecision(config, evaluation.key, identity, signal),
            signal
          ),
        signal
      )
      evaluation.source = "provider"
      validateDecision(decision, options)
    }
    evaluation.decision = decision
    const afterMeta = { source: evaluation.source }

    result = extractDecisionValue(decision)
    if (preparation.providerRequired && cacheConsultation) {
      writeCacheDecision(config, runtime.cache, hookContext, cacheConsultation, decision)
    }
    postCommitHooks = runAfterHooks(
      hooks,
      hookContext,
      decision,
      afterMeta,
      config.onHookError
    ).then(() => runFinallyHooks(hooks, hookContext, config.onHookError))
    consumeCleanup(postCommitHooks)
  } catch (error) {
    const gateError = normalizeError(error)
    if (!preparation.reported) {
      reportPreparation(false)
    }
    failure = gateError
    evaluation.source = "default"
    const errorHooks = runErrorHooks(hooks, hookContext, gateError, config.onHookError)

    if (signal.aborted) {
      consumeCleanup(errorHooks)
    } else {
      try {
        await raceWithSignal(() => errorHooks, signal)
      } catch {
        consumeCleanup(errorHooks)
      }
    }
  } finally {
    if (!postCommitHooks) {
      consumeCleanup(runFinallyHooks(hooks, hookContext, config.onHookError))
    }
    cleanup()
  }

  const detailsBase = {
    flagKey: evaluation.key,
    value: result ?? options.defaultValue,
  }

  if (failure !== undefined) {
    return { ...detailsBase, error: failure, source: "default" }
  }

  if (evaluation.source === "default") {
    throw new Error("A successful evaluation requires a decision source")
  }

  if (evaluation.decision?.type === "variant" && evaluation.decision.payload !== undefined) {
    return {
      ...detailsBase,
      payload: evaluation.decision.payload as TPayload,
      source: evaluation.source,
    }
  }

  return { ...detailsBase, source: evaluation.source }
}

export async function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity | null>,
  runtime?: EvaluationRuntime
): Promise<boolean | T[number]> {
  const details = await executeGateDetails(config, options, callOptions, undefined, runtime)
  return details.value
}
