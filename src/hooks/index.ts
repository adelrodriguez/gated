import type { Hook, Identity } from "../lib/types"

export function defineHook<TIdentity extends Identity = Identity>(
  hook: Hook<TIdentity>
): Hook<TIdentity>
export function defineHook<TOptions = void, TIdentity extends Identity = Identity>(
  factory: (options: TOptions) => Hook<TIdentity>
): undefined extends TOptions
  ? (options?: Exclude<TOptions, undefined>) => Hook<TIdentity>
  : (options: TOptions) => Hook<TIdentity>
export function defineHook<TOptions = void, TIdentity extends Identity = Identity>(
  definition: Hook<TIdentity> | ((options: TOptions) => Hook<TIdentity>)
): Hook<TIdentity> | ((options: TOptions) => Hook<TIdentity>) {
  return definition
}
