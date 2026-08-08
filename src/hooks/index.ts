import type { Hook, Identity } from "../lib/types"

export { HookResolutionAbortError } from "../lib/hook-control"

export function createHook<TOptions = void, TIdentity extends Identity = Identity>(
  factory: (options: TOptions) => Hook<TIdentity>
): (options: TOptions) => Hook<TIdentity> {
  return factory
}
