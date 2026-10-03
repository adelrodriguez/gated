import type { ResolvedConfig } from "#lib/config/resolved-config"
import type {
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateCallOptions,
  HookContext,
  GateConfiguration,
  GateOptions,
  Identity,
} from "#lib/types"
import { createHookRunner } from "#lib/evaluation/stages/hooks"
import { resolveDecision } from "#lib/evaluation/stages/resolve"
import { getGateConfiguration } from "#lib/gate/configuration"
import { extractDecisionValue } from "#lib/gate/decision"
import { createEvaluationSignal, raceWithSignal } from "#lib/shared/signals"
import { normalizeError } from "#lib/shared/utils"

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

/**
 * Where one evaluation gets its identity and its provider decision. The direct path passes the
 * resolved config itself. The batch path passes one adapter for each `batch()` call that returns
 * the pre-resolved identity and joins the batch flush round.
 */
export type GateSource<TIdentity extends Identity> = Pick<
  ResolvedConfig<TIdentity>,
  "resolveIdentity" | "decide"
>

/**
 * The deadline for one evaluation. `timeoutMs` makes the engine create its own timeout around the
 * caller signal. `signal` is a deadline the caller already built, such as a batch entry signal that
 * includes the caller signal and the entry timeout; the engine adds no timeout of its own.
 */
export type EvaluationDeadline = { timeoutMs: number | undefined } | { signal: AbortSignal }

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
  config: ResolvedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions: GateCallOptions<TIdentity | null> | undefined,
  source: GateSource<TIdentity>,
  deadline: EvaluationDeadline
): Promise<EvaluationDetails<boolean | T[number], TPayload>> {
  const gateConfiguration = getGateConfiguration(options.variants)
  const { cleanup, signal } =
    "signal" in deadline
      ? createEvaluationSignal(deadline.signal)
      : createEvaluationSignal(callOptions?.signal, deadline.timeoutMs)
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
  const hookRunner = createHookRunner(config.hooks, hookContext, config.onHookError)
  let result: boolean | T[number] | undefined
  let failure: Error | undefined
  let finallyDispatched = false

  try {
    const identity = await raceWithSignal(
      () => source.resolveIdentity(callOptions?.identity),
      signal
    )
    evaluation.identity = identity

    await raceWithSignal(() => hookRunner.before(), signal)

    const resolution = await resolveDecision(
      config,
      hookContext,
      options,
      () => source.decide(evaluation.key, identity, { signal }),
      signal
    )
    const { decision } = resolution
    evaluation.decision = decision
    evaluation.source = resolution.source
    const afterMeta = { source: resolution.source }

    result = extractDecisionValue(decision)
    hookRunner.dispatchAfterThenFinally(decision, afterMeta)
    finallyDispatched = true
  } catch (error) {
    const gateError = normalizeError(error)
    failure = gateError
    evaluation.source = "default"

    if (signal.aborted) {
      hookRunner.dispatchError(gateError)
    } else {
      try {
        await raceWithSignal(() => hookRunner.error(gateError), signal)
      } catch {
        // The deadline passed while the error hooks ran. They finish without blocking the result.
      }
    }
  } finally {
    if (!finallyDispatched) {
      hookRunner.dispatchFinally()
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
  config: ResolvedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions: GateCallOptions<TIdentity | null> | undefined,
  source: GateSource<TIdentity>,
  deadline: EvaluationDeadline
): Promise<boolean | T[number]> {
  const details = await executeGateDetails(config, options, callOptions, source, deadline)
  return details.value
}
