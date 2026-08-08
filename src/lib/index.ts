import type {
  AfterHookMeta,
  Decision,
  DecisionSource,
  GatedConfig,
  Hook,
  HookContext,
  Identity,
  MaybePromise,
} from "./types"
import { HookResolutionAbortError } from "./hook-control"

type Evaluation<TIdentity extends Identity> = {
  key: string
  identity: TIdentity | null
  decision?: Decision
  source?: DecisionSource | "default"
  resolver?: Hook<TIdentity>
  error?: unknown
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

export async function identify<TIdentity extends Identity>(
  fn: () => MaybePromise<TIdentity | null>,
  overrideIdentity?: TIdentity
): Promise<TIdentity> {
  if (overrideIdentity) {
    return overrideIdentity
  }

  const resolvedIdentity = await fn()

  if (!resolvedIdentity) {
    throw new Error("Identity not found")
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
  hookContext: HookContext<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve(hook.before?.(hookContext)))

  await Promise.allSettled(tasks)
}

export async function runResolveHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  validate: (decision: Decision) => void
): Promise<HookResolution<TIdentity> | undefined> {
  for (const hook of hooks) {
    try {
      // Hooks resolve in registration order and short-circuit on the first decision.
      // oxlint-disable-next-line no-await-in-loop
      const value = await hook.resolve?.(hookContext)

      if (value !== undefined && value !== null) {
        validate(value)
        return { decision: value, resolver: hook }
      }
    } catch (error) {
      if (error instanceof HookResolutionAbortError) {
        throw error.originalError instanceof Error ? error.originalError : error
      }

      // Thrown and invalid hook decisions are isolated to their resolver.
      // Continue to later hooks and then the provider.
    }
  }

  return undefined
}

export async function runAfterHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  decision: Decision,
  meta: AfterHookMeta<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve(hook.after?.(hookContext, decision, meta)))
  await Promise.allSettled(tasks)
}

export async function runErrorHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  error: unknown
) {
  const tasks = hooks.map((hook) => Promise.resolve(hook.error?.(hookContext, error)))
  await Promise.allSettled(tasks)
}

export async function runFinallyHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve(hook.finally?.(hookContext)))
  await Promise.allSettled(tasks)
}

export function validateDecision<T extends string[]>(decision: Decision, options: GateOptions<T>) {
  const isVariant = "variant" in decision

  if (options.variants && !isVariant) {
    throw new Error(
      `Type mismatch: expected variant decision but received boolean "${decision.value}"`
    )
  }

  if (!options.variants && isVariant) {
    throw new Error(
      `Type mismatch: expected boolean decision but received variant "${decision.variant}"`
    )
  }

  if (!isVariant || !options.variants) {
    return
  }

  if (!options.variants.includes(decision.variant)) {
    throw new Error(`Invalid variant: ${decision.variant}`)
  }
}

export async function executeGate<TIdentity extends Identity, T extends string[] = string[]>(
  config: GatedConfig<TIdentity>,
  options: GateOptions<T>,
  overrideIdentity?: TIdentity
): Promise<boolean | T[number]> {
  const hooks = config.hooks ?? []
  const evaluation: Evaluation<TIdentity> = {
    identity: null,
    key: options.key,
  }
  // A single context object must span every phase: stateful hooks use its identity as an
  // ownership token so followers cannot settle or delete another evaluation's work.
  const hookContext: HookContext<TIdentity> = {
    get flagKey() {
      return evaluation.key
    },
    get identity() {
      return evaluation.identity
    },
  }
  let result: boolean | T[number] | undefined

  try {
    evaluation.identity = await identify(config.identify, overrideIdentity)

    await runBeforeHooks(hooks, hookContext)

    const resolution = await runResolveHooks(hooks, hookContext, (decision) => {
      validateDecision(decision, options)
    })

    if (resolution === undefined) {
      evaluation.decision = await evaluateDecision(
        config.decide,
        evaluation.key,
        evaluation.identity
      )
      evaluation.source = "provider"
    } else {
      evaluation.decision = resolution.decision
      evaluation.source = "hook"
      evaluation.resolver = resolution.resolver
    }

    validateDecision(evaluation.decision, options)

    let afterMeta: AfterHookMeta<TIdentity>

    if (evaluation.source === "hook") {
      const resolver = evaluation.resolver

      if (!resolver) {
        throw new Error("Hook-resolved decision is missing its resolver")
      }

      afterMeta = { resolver, source: "hook" }
    } else {
      afterMeta = { source: "provider" }
    }

    await runAfterHooks(hooks, hookContext, evaluation.decision, afterMeta)

    result = extractDecisionValue(evaluation.decision)
  } catch (error) {
    // Plan 07 exposes these forward-looking evaluation details to package consumers.
    evaluation.error = error
    evaluation.source = "default"
    await runErrorHooks(hooks, hookContext, error)
  } finally {
    await runFinallyHooks(hooks, hookContext)
  }

  return result ?? options.defaultValue
}
