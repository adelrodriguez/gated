import type {
  AfterHookMeta,
  AnonymousGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateCallOptions,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "./types"
import {
  DecisionTypeMismatchError,
  DuplicateBatchKeyError,
  GateTimeoutError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
} from "./errors"
import { HookResolutionAbortError, normalizeError } from "./internal"

const noop: () => void = () => null

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

type HookResolution<TIdentity extends Identity> = {
  decision: Decision
  resolver: Hook<TIdentity>
}

export type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
  timeoutMs?: number
}

function getGateConfiguration(
  variants?: readonly string[]
): { kind: "boolean" } | { kind: "variant"; variants: readonly string[] } {
  return variants ? { kind: "variant", variants } : { kind: "boolean" }
}

type IdentityResult<TIdentity extends Identity> = { error: Error } | { value: TIdentity | null }

type ExecutionOverrides<TIdentity extends Identity> = {
  identityResult: IdentityResult<TIdentity>
  onPrepared: (providerRequired: boolean) => void
  provider: () => Promise<Decision>
}

export type BatchEntry = {
  flag: object
  options: GateOptions<string[]>
}

type HookErrorReporter<TIdentity extends Identity> = GatedConfig<TIdentity>["onHookError"]
type AnyGatedConfig<TIdentity extends Identity> =
  | GatedConfig<TIdentity>
  | AnonymousGatedConfig<TIdentity>

function reportHookError<TIdentity extends Identity>(
  reporter: HookErrorReporter<TIdentity>,
  report: HookErrorReport<TIdentity>
) {
  if (!reporter) {
    return
  }

  // The report retains the stable, live HookContext reused across lifecycle phases; it is not
  // a snapshot. Its key and identity remain fixed after evaluation begins.
  void Promise.resolve()
    .then(() => reporter(report))
    .catch(() => null)
}

function reportRejectedHooks<TIdentity extends Identity>(
  results: Array<PromiseSettledResult<void>>,
  phase: HookErrorReport["phase"],
  hookContext: HookContext<TIdentity>,
  reporter: HookErrorReporter<TIdentity>
) {
  results.forEach((result, hookIndex) => {
    if (result.status === "rejected") {
      const error = normalizeError(result.reason as IdentityValue)
      reportHookError(reporter, {
        context: hookContext,
        error,
        hookIndex,
        phase,
      })
    }
  })
}

export async function identify<TIdentity extends Identity>(
  fn: () => MaybePromise<TIdentity | null>,
  overrideIdentity?: TIdentity | null,
  allowAnonymous = false
): Promise<TIdentity | null> {
  if (overrideIdentity !== undefined && overrideIdentity !== null) {
    return overrideIdentity
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

async function evaluateConfiguredDecision<TIdentity extends Identity>(
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

async function evaluateConfiguredMany<TIdentity extends Identity>(
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

function abortReason(signal: AbortSignal): Error {
  return normalizeError(signal.reason as IdentityValue)
}

function createEvaluationSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): { cleanup: () => void; signal: AbortSignal } {
  if (timeoutMs === undefined) {
    const signal = callerSignal ?? new AbortController().signal
    return { cleanup: noop, signal }
  }

  const controller = new AbortController()
  let removeCallerListener = noop

  if (callerSignal) {
    const forwardCallerAbort = () => {
      controller.abort(callerSignal.reason)
    }

    if (callerSignal.aborted) {
      forwardCallerAbort()
    } else {
      callerSignal.addEventListener("abort", forwardCallerAbort, { once: true })
      removeCallerListener = () => {
        callerSignal.removeEventListener("abort", forwardCallerAbort)
      }
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new GateTimeoutError(timeoutMs))
  }, timeoutMs)

  return {
    cleanup() {
      removeCallerListener()
      clearTimeout(timer)
    },
    signal: controller.signal,
  }
}

async function raceWithSignal<T>(operation: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw abortReason(signal)
  }

  let removeAbortListener = noop
  const aborted = new Promise<never>((resolve, reject) => {
    void resolve
    const onAbort = () => {
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    removeAbortListener = () => {
      signal.removeEventListener("abort", onAbort)
    }
  })
  const pending = Promise.resolve().then(operation)
  void pending.catch(() => null)

  try {
    return await Promise.race([pending, aborted])
  } finally {
    removeAbortListener()
  }
}

function consumeCleanup(promise: Promise<void>): void {
  void promise.catch(() => null)
}

export async function runBeforeHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.before?.(hookContext)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "before", hookContext, reporter)
}

export async function runResolveHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  validate: (decision: Decision) => void,
  reporter?: HookErrorReporter<TIdentity>
): Promise<HookResolution<TIdentity> | undefined> {
  for (const [hookIndex, hook] of hooks.entries()) {
    if (hookContext.signal.aborted) {
      throw abortReason(hookContext.signal)
    }

    try {
      // Hooks resolve in registration order and short-circuit on the first decision.
      // oxlint-disable-next-line no-await-in-loop
      const value = await Promise.resolve().then(() => hook.resolve?.(hookContext))

      if (value !== undefined && value !== null) {
        validate(value)
        return { decision: value, resolver: hook }
      }
    } catch (error) {
      if (error instanceof HookResolutionAbortError) {
        throw error.originalError
      }

      const hookError = normalizeError(error as IdentityValue)

      reportHookError(reporter, {
        context: hookContext,
        error: hookError,
        hookIndex,
        phase: "resolve",
      })
    }
  }

  return undefined
}

export async function runAfterHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  decision: Decision,
  meta: AfterHookMeta<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) =>
    Promise.resolve().then(() => hook.after?.(hookContext, decision, meta))
  )
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "after", hookContext, reporter)
}

export async function runErrorHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  error: Error,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.error?.(hookContext, error)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "error", hookContext, reporter)
}

export async function runFinallyHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.finally?.(hookContext)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "finally", hookContext, reporter)
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

export async function executeGateDetails<TIdentity extends Identity, T extends string[] = string[]>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity>,
  execution?: ExecutionOverrides<TIdentity>
): Promise<EvaluationDetails<boolean | T[number]>> {
  const hooks = config.hooks ?? []
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
  // A single context object must span every phase: stateful hooks use this object's reference
  // (not its `identity` field) as an ownership token so followers cannot settle or delete
  // another evaluation's work.
  const hookContext: HookContext<TIdentity> =
    gateConfiguration.kind === "variant"
      ? {
          get defaultValue() {
            return evaluation.defaultValue as string
          },
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
          get variants() {
            return gateConfiguration.variants
          },
        }
      : {
          get defaultValue() {
            return evaluation.defaultValue as boolean
          },
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
  let result: boolean | T[number] | undefined
  let failure: Error | undefined
  let preparationReported = false
  const reportPreparation = (providerRequired: boolean): void => {
    if (!preparationReported) {
      preparationReported = true
      execution?.onPrepared(providerRequired)
    }
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
      reportPreparation(true)
      decision = await raceWithSignal(
        () =>
          execution?.provider() ??
          evaluateConfiguredDecision(config, evaluation.key, identity, signal),
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

    await raceWithSignal(
      () => runAfterHooks(hooks, hookContext, decision, afterMeta, config.onHookError),
      signal
    )

    result = extractDecisionValue(decision)
  } catch (error) {
    const gateError = normalizeError(error as IdentityValue)
    // Plan 07 exposes these forward-looking evaluation details to package consumers.
    reportPreparation(false)
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
    const finallyHooks = runFinallyHooks(hooks, hookContext, config.onHookError)

    try {
      await raceWithSignal(() => finallyHooks, signal)
    } catch {
      consumeCleanup(finallyHooks)
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

  const details: EvaluationDetails<boolean | T[number]> = {
    ...detailsBase,
    source: evaluation.source as DecisionSource,
  }

  if (evaluation.decision?.type === "variant" && evaluation.decision.payload !== undefined) {
    details.payload = evaluation.decision.payload
  }

  return details
}

type DecisionRequest = {
  promise: Promise<Decision>
  reject: (error: Error) => void
  resolve: (decision: Decision) => void
}

function createDecisionRequest(): DecisionRequest {
  let rejectRequest!: (error: Error) => void
  let resolveRequest!: (decision: Decision) => void
  const promise = new Promise<Decision>((resolve, reject) => {
    rejectRequest = (error) => {
      reject(error)
    }
    resolveRequest = resolve
  })
  void promise.catch(() => null)
  return { promise, reject: rejectRequest, resolve: resolveRequest }
}

export async function executeGateBatch<TIdentity extends Identity>(
  config: AnyGatedConfig<TIdentity>,
  entries: readonly BatchEntry[],
  callOptions?: GateCallOptions<TIdentity>
): Promise<Map<object, EvaluationDetails<boolean | string>>> {
  const duplicateKey = entries
    .map((entry) => entry.options.key)
    .find((key, index, keys) => keys.indexOf(key) !== index)
  if (duplicateKey !== undefined) {
    throw new DuplicateBatchKeyError(duplicateKey)
  }

  const effectiveTimeouts = entries.map((entry) => entry.options.timeoutMs ?? config.timeoutMs)
  const batchTimeoutMs =
    effectiveTimeouts.length === 0
      ? config.timeoutMs
      : effectiveTimeouts.includes(undefined)
        ? undefined
        : Math.max(...(effectiveTimeouts as number[]))
  const batchTimeout = createEvaluationSignal(callOptions?.signal, batchTimeoutMs)
  // Aborting this controller on the way out cancels a batch left in flight by an early return.
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
    identityResult = { error: normalizeError(error as IdentityValue) }
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
            request.reject(normalizeError(error as IdentityValue))
          }
        })
      )
    } catch (error) {
      for (const entry of unresolved) {
        requests.get(entry.flag)?.reject(normalizeError(error as IdentityValue))
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

export async function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: AnyGatedConfig<TIdentity>,
  options: GateOptions<T>,
  callOptions?: GateCallOptions<TIdentity>
): Promise<boolean | T[number]> {
  const details = await executeGateDetails(config, options, callOptions)
  return details.value
}
