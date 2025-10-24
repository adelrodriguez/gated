import type { Decision, Hook, HookContext, Identity } from "./types"

export async function identify<TIdentity extends Identity>(
  fn: () => TIdentity | null | Promise<TIdentity | null>,
  overrideIdentity: TIdentity | undefined
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

export function extractDecisionValue(
  decision: Decision,
  expectedType?: "boolean" | "variant"
) {
  const isVariant = "variant" in decision
  const value = isVariant ? decision.variant : decision.value

  if (expectedType === "boolean" && isVariant) {
    throw new Error(
      `Type mismatch: expected boolean decision but received variant "${decision.variant}"`
    )
  }

  if (expectedType === "variant" && !isVariant) {
    throw new Error(
      `Type mismatch: expected variant decision but received boolean "${decision.value}"`
    )
  }

  return value
}

export async function evaluateDecision<TIdentity extends Identity>(
  decide: (key: string, identity: TIdentity) => Decision | Promise<Decision>,
  gateKey: string,
  gateIdentity: TIdentity,
  variants?: readonly string[]
): Promise<Decision> {
  const decision = await decide(gateKey, gateIdentity)

  if ("variant" in decision) {
    validateVariant(decision.variant, variants)
  }

  return decision
}

export async function runBeforeHooks<TIdentity extends Identity>(
  hooks: Hook<TIdentity>[],
  hookContext: HookContext<TIdentity>
) {
  const tasks = hooks.map((hook) => hook.before?.(hookContext))

  await Promise.allSettled(tasks)
}

export async function runResolveHooks<TIdentity extends Identity>(
  hooks: Hook<TIdentity>[],
  hookContext: HookContext<TIdentity>
) {
  for (const hook of hooks) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: we need to await the hook
      const value = await hook.resolve?.(hookContext)

      if (value !== undefined) {
        return value
      }
    } catch {
      // Continue to next hook if this one fails
    }
  }

  return
}

export async function runAfterHooks<TIdentity extends Identity>(
  hooks: Hook<TIdentity>[],
  hookContext: HookContext<TIdentity>,
  decision: Decision
) {
  const tasks = hooks.map((hook) => hook.after?.(hookContext, decision))
  await Promise.allSettled(tasks)
}

export async function runErrorHooks<TIdentity extends Identity>(
  hooks: Hook<TIdentity>[],
  hookContext: HookContext<TIdentity>,
  error: unknown
) {
  const tasks = hooks.map((hook) => hook.error?.(hookContext, error))
  await Promise.allSettled(tasks)
}

export async function runFinallyHooks<TIdentity extends Identity>(
  hooks: Hook<TIdentity>[],
  hookContext: HookContext<TIdentity>
) {
  const tasks = hooks.map((hook) => hook.finally?.(hookContext))
  await Promise.allSettled(tasks)
}

function validateVariant(value: string, variants?: readonly string[]) {
  if (!variants) {
    return
  }

  if (!variants.includes(value)) {
    throw new Error(`Invalid variant: ${value}`)
  }
}

export async function executeGate<
  TIdentity extends Identity,
  T extends string[] = string[],
>(
  config: {
    identify: () => TIdentity | null | Promise<TIdentity | null>
    decide: (key: string, identity: TIdentity) => Decision | Promise<Decision>
    hooks?: Hook<TIdentity>[]
  },
  options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
  },
  overrideIdentity?: TIdentity
): Promise<boolean | T[number]> {
  const hooks = config?.hooks ?? []
  let identity: TIdentity | null = null
  let result: boolean | T[number] | undefined

  const expectedType = options.variants ? "variant" : "boolean"

  try {
    identity = await identify(config.identify, overrideIdentity)

    const hookContext = { flagKey: options.key, identity }

    await runBeforeHooks(hooks, hookContext)

    const resolveResult = await runResolveHooks(hooks, hookContext)

    if (resolveResult) {
      return extractDecisionValue(resolveResult, expectedType)
    }

    const decision = await evaluateDecision(
      config.decide,
      options.key,
      identity,
      options.variants
    )

    await runAfterHooks(hooks, hookContext, decision)

    result = extractDecisionValue(decision, expectedType)
  } catch (error) {
    await runErrorHooks(hooks, { flagKey: options.key, identity }, error)
  } finally {
    await runFinallyHooks(hooks, { flagKey: options.key, identity })
  }

  return result ?? options.defaultValue
}
