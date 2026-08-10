import type { Decision, Identity, MaybePromise } from "../types"
import type { AnyGatedConfig } from "./shared"
import { IdentityNotFoundError } from "../errors"

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
