import type { Hook, Identity } from "./lib/types"

export function defineHook<TIdentity extends Identity = Identity>(
  hook: Hook<TIdentity>
): Hook<TIdentity>
export function defineHook<
  TOptions = unknown,
  TIdentity extends Identity = Identity,
>(
  factory: (options: TOptions) => Hook<TIdentity>
): (options: TOptions) => Hook<TIdentity>
// biome-ignore lint/suspicious/noExplicitAny: Override
export function defineHook(hookOrFactory: any): any {
  return hookOrFactory
}
