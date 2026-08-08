import type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  IdentityValue,
  MaybePromise,
} from "./types"
import { DecisionTypeMismatchError, IdentityNotFoundError, InvalidVariantError } from "./errors"
import { HookResolutionAbortError, normalizeError } from "./internal"

type Evaluation<TIdentity extends Identity> = {
  defaultValue: boolean | string
  key: string
  kind: "boolean" | "variant"
  identity: TIdentity | null
  decision?: Decision
  source?: DecisionSource | "default"
  error?: Error
  variants?: readonly string[]
}

type HookResolution<TIdentity extends Identity> = {
  decision: Decision
  resolver: Hook<TIdentity>
}

type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
}

function getGateConfiguration(
  variants?: readonly string[]
): { kind: "boolean" } | { kind: "variant"; variants: readonly string[] } {
  return variants ? { kind: "variant", variants } : { kind: "boolean" }
}

type HookErrorReporter<TIdentity extends Identity> = GatedConfig<TIdentity>["onHookError"]

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
  overrideIdentity?: TIdentity
): Promise<TIdentity> {
  if (overrideIdentity) {
    return overrideIdentity
  }

  const resolvedIdentity = await fn()

  if (!resolvedIdentity) {
    throw new IdentityNotFoundError()
  }

  return resolvedIdentity
}

export function extractDecisionValue(decision: Decision) {
  const isVariant = "variant" in decision
  return isVariant ? decision.variant : decision.value
}

export async function evaluateDecision<TIdentity extends Identity>(
  decide: (key: string, identity: TIdentity) => MaybePromise<Decision>,
  gateKey: string,
  gateIdentity: TIdentity
): Promise<Decision> {
  return await decide(gateKey, gateIdentity)
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

export function validateDecision<T extends string[]>(decision: Decision, options: GateOptions<T>) {
  const isVariant = "variant" in decision
  const gateConfiguration = getGateConfiguration(options.variants)

  if (gateConfiguration.kind === "variant" && !isVariant) {
    throw new DecisionTypeMismatchError("variant", decision)
  }

  if (gateConfiguration.kind === "boolean" && isVariant) {
    throw new DecisionTypeMismatchError("boolean", decision)
  }

  if (!isVariant || gateConfiguration.kind === "boolean") {
    return
  }

  if (!gateConfiguration.variants.includes(decision.variant)) {
    throw new InvalidVariantError(decision.variant, gateConfiguration.variants)
  }
}

export async function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: GatedConfig<TIdentity>,
  options: GateOptions<T>,
  overrideIdentity?: TIdentity
): Promise<boolean | T[number]> {
  const hooks = config.hooks ?? []
  const gateConfiguration = getGateConfiguration(options.variants)
  const evaluation: Evaluation<TIdentity> = {
    defaultValue: options.defaultValue,
    identity: null,
    key: options.key,
    kind: gateConfiguration.kind,
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
          variants: undefined,
        }
  let result: boolean | T[number] | undefined

  try {
    evaluation.identity = await identify(config.identify, overrideIdentity)

    await runBeforeHooks(hooks, hookContext, config.onHookError)

    const resolution = await runResolveHooks(
      hooks,
      hookContext,
      (decision) => {
        validateDecision(decision, options)
      },
      config.onHookError
    )

    if (resolution === undefined) {
      evaluation.decision = await evaluateDecision(
        config.decide,
        evaluation.key,
        evaluation.identity
      )
      evaluation.source = "provider"
      validateDecision(evaluation.decision, options)
    } else {
      evaluation.decision = resolution.decision
      evaluation.source = "hook"
    }

    const afterMeta: AfterHookMeta<TIdentity> = resolution
      ? { resolver: resolution.resolver, source: "hook" }
      : { source: "provider" }

    await runAfterHooks(hooks, hookContext, evaluation.decision, afterMeta, config.onHookError)

    result = extractDecisionValue(evaluation.decision)
  } catch (error) {
    const gateError = normalizeError(error as IdentityValue)
    // Plan 07 exposes these forward-looking evaluation details to package consumers.
    evaluation.error = gateError
    evaluation.source = "default"
    await runErrorHooks(hooks, hookContext, gateError, config.onHookError)
  } finally {
    await runFinallyHooks(hooks, hookContext, config.onHookError)
  }

  return result ?? options.defaultValue
}
