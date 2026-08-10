import type {
  AfterHookMeta,
  AnonymousGatedConfig,
  CoalescingOptions,
  CallerIdentityGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  FallbackReport,
  GateCallOptions,
  GatedConfig,
  HookContext,
  Identity,
  MaybePromise,
} from "./types"
import {
  DecisionTypeMismatchError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
} from "./errors"
import { getDefaultCoalescingKey } from "./evaluation-key"
import {
  reportInBackground,
  runAfterHooks,
  runBeforeHooks,
  runErrorHooks,
  runFinallyHooks,
  runResolveHooks,
} from "./hook-runner"
import { normalizeError } from "./internal"
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
  state?: Map<unknown, unknown>
}

type PendingDecision = {
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

const pendingByConfig = new WeakMap<object, Map<string, PendingDecision>>()

export type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
  timeoutMs?: number
}

type GateConfiguration = { kind: "boolean" } | { kind: "variant"; variants: readonly string[] }

export type IdentityResult<TIdentity extends Identity> =
  | { error: Error }
  | { value: TIdentity | null }

/**
 * Contract between the batch orchestrator and one evaluation.
 *
 * `identityResult` replaces identity resolution. `onPrepared` fires exactly once, before provider
 * work: `true` only when this evaluation owns provider work, and `false` after hook resolution, a
 * pre-provider failure, or when it follows coalesced work. `provider` replaces configured `decide`
 * and is not called before `onPrepared(true)`.
 */
export type ExecutionOverrides<TIdentity extends Identity> = {
  identityResult: IdentityResult<TIdentity>
  onPrepared: (providerRequired: boolean) => void
  provider: () => Promise<Decision>
}

export type AnyGatedConfig<TIdentity extends Identity> =
  | GatedConfig<TIdentity>
  | AnonymousGatedConfig<TIdentity>
  | CallerIdentityGatedConfig<TIdentity>

function getGateConfiguration(variants?: readonly string[]): GateConfiguration {
  return variants ? { kind: "variant", variants } : { kind: "boolean" }
}

function createHookContext<TIdentity extends Identity>(
  evaluation: Evaluation<TIdentity>,
  gateConfiguration: GateConfiguration
): HookContext<TIdentity> {
  const record = evaluation
  const context = {
    get defaultValue() {
      return evaluation.defaultValue
    },
    get flagKey() {
      return evaluation.key
    },
    get identity() {
      return evaluation.identity
    },
    kind: gateConfiguration.kind,
    get signal() {
      return evaluation.signal
    },
    get state() {
      return (record.state ??= new Map())
    },
    get variants() {
      return gateConfiguration.kind === "variant" ? gateConfiguration.variants : undefined
    },
  }

  return context as HookContext<TIdentity>
}

function reportFallback<TIdentity extends Identity>(
  reporter: GatedConfig<TIdentity>["onFallback"],
  report: FallbackReport<TIdentity>
): void {
  reportInBackground(reporter, report)
}

function getCoalescingOptions(config: object): CoalescingOptions | undefined {
  const option = Reflect.get(config, "coalesce") as boolean | CoalescingOptions | undefined
  if (option === true) {
    return {}
  }
  if (option === false || option === undefined) {
    return undefined
  }
  return option
}

function getCoalescingKey(context: HookContext, options: CoalescingOptions): string | undefined {
  if (!context.identity) {
    return undefined
  }
  if (options.key) {
    return options.key(context)
  }
  const { distinctId } = context.identity
  return getDefaultCoalescingKey(context.flagKey, context.kind, context.variants, distinctId)
}

async function coalesceProviderDecision(
  config: object,
  context: HookContext,
  onPrepared: (providerRequired: boolean) => void,
  provider: () => Decision | Promise<Decision>,
  signal: AbortSignal
): Promise<Decision> {
  const options = getCoalescingOptions(config)
  if (!options) {
    onPrepared(true)
    return await provider()
  }

  const key = getCoalescingKey(context, options)
  if (key === undefined) {
    onPrepared(true)
    return await provider()
  }

  let pending = pendingByConfig.get(config)
  if (!pending) {
    pending = new Map()
    pendingByConfig.set(config, pending)
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

export async function identify<TIdentity extends Identity>(
  fn: (() => MaybePromise<TIdentity | null>) | undefined,
  overrideIdentity?: TIdentity | null,
  allowAnonymous = false
): Promise<TIdentity | null> {
  if (overrideIdentity !== undefined) {
    if (overrideIdentity === null && !allowAnonymous) {
      throw new IdentityNotFoundError()
    }

    return overrideIdentity
  }

  if (!fn) {
    throw new IdentityNotFoundError()
  }

  const resolvedIdentity = await fn()

  if (!resolvedIdentity) {
    if (!allowAnonymous) {
      throw new IdentityNotFoundError()
    }

    return null
  }

  return resolvedIdentity
}

export async function evaluateConfiguredDecision<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  key: string,
  identity: TIdentity | null,
  signal: AbortSignal
): Promise<Decision> {
  if (config.anonymous === "allow") {
    return await config.decide(key, identity, { signal })
  }
  if (identity === null) {
    throw new IdentityNotFoundError()
  }
  return await config.decide(key, identity, { signal })
}

export async function evaluateConfiguredMany<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  keys: readonly string[],
  identity: TIdentity | null,
  signal: AbortSignal
): Promise<Record<string, Decision>> {
  if (!config.decideMany) {
    return {}
  }
  if (config.anonymous === "allow") {
    return await config.decideMany(keys, identity, { signal })
  }
  if (identity === null) {
    throw new IdentityNotFoundError()
  }
  return await config.decideMany(keys, identity, { signal })
}

export function extractDecisionValue(decision: Decision) {
  return decision.type === "variant" ? decision.variant : decision.value
}

export function validateDecision<T extends string[]>(
  decision: unknown,
  options: GateOptions<T>
): asserts decision is Decision {
  if (typeof decision !== "object" || decision === null) {
    throw new MalformedDecisionError(decision, "expected an object")
  }

  const type = Reflect.get(decision, "type")

  if (type !== "boolean" && type !== "variant") {
    throw new MalformedDecisionError(decision, 'type must be "boolean" or "variant"')
  }

  if (type === "boolean" && typeof Reflect.get(decision, "value") !== "boolean") {
    throw new MalformedDecisionError(decision, "boolean value must be a boolean")
  }

  if (type === "variant" && typeof Reflect.get(decision, "variant") !== "string") {
    throw new MalformedDecisionError(decision, "variant must be a string")
  }

  const validDecision = decision as Decision
  const isVariant = validDecision.type === "variant"
  const gateConfiguration = getGateConfiguration(options.variants)

  if (gateConfiguration.kind === "variant" && !isVariant) {
    throw new DecisionTypeMismatchError("variant", validDecision)
  }

  if (gateConfiguration.kind === "boolean" && isVariant) {
    throw new DecisionTypeMismatchError("boolean", validDecision)
  }

  if (!isVariant || gateConfiguration.kind === "boolean") {
    return
  }

  if (!gateConfiguration.variants.includes(validDecision.variant)) {
    throw new InvalidVariantError(validDecision.variant, gateConfiguration.variants)
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
  execution?: ExecutionOverrides<TIdentity>
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
  const preparation = { reported: false }
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

    const resolution = await raceWithSignal(
      () =>
        runResolveHooks(
          hooks,
          hookContext,
          (decision) => {
            validateDecision(decision, options)
          },
          config.onHookError
        ),
      signal
    )

    let decision: Decision
    if (resolution === undefined) {
      decision = await raceWithSignal(
        () =>
          coalesceProviderDecision(
            config,
            hookContext,
            reportPreparation,
            () =>
              execution?.provider() ??
              evaluateConfiguredDecision(config, evaluation.key, identity, signal),
            signal
          ),
        signal
      )
      evaluation.source = "provider"
      validateDecision(decision, options)
    } else {
      reportPreparation(false)
      decision = resolution.decision
      evaluation.source = "hook"
    }
    evaluation.decision = decision
    const afterMeta: AfterHookMeta<TIdentity> = resolution
      ? { resolver: resolution.resolver, source: "hook" }
      : { source: "provider" }

    result = extractDecisionValue(decision)
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
    reportFallback(config.onFallback, {
      defaultValue: evaluation.defaultValue,
      error: gateError,
      flagKey: evaluation.key,
      identity: evaluation.identity,
    })

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

  const details = {
    ...detailsBase,
    source: evaluation.source as DecisionSource,
  }

  if (evaluation.decision?.type === "variant" && evaluation.decision.payload !== undefined) {
    return {
      ...details,
      payload: evaluation.decision.payload as TPayload,
    } as EvaluationDetails<boolean | T[number], TPayload>
  }

  return details
}

export async function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity | null>
): Promise<boolean | T[number]> {
  const details = await executeGateDetails(config, options, callOptions)
  return details.value
}
