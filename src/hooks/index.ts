import type { Hook, Identity } from "../lib/types"

/**
 * Defines a hook object. The same object is shared by every gate it is registered on, so any
 * mutable state in its closure is shared too. Prefer the factory overload when the hook keeps state.
 */
export function defineHook<TIdentity extends Identity = Identity>(
  hook: Hook<TIdentity>
): Hook<TIdentity>
/**
 * Defines a hook factory with typed options. Each invocation produces a fresh hook, so closure state
 * stays isolated per registration.
 */
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
