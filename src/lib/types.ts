/**
 * The identity of the user for evaluation of the flags
 */
export type Identity = {
  /**
   * A unique identifier for the user
   */
  distinctId: string | number
} & Record<string, unknown>

export type Decision =
  | {
      value: boolean
    }
  | { variant: string }

export type HookContext<
  TIdentity extends Identity = Identity,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> = {
  flagKey: string
  identity: TIdentity | null
} & TOptions

export interface Hook<T extends Identity = Identity> {
  before?(hookContext: HookContext<T>): void | Promise<void>
  resolve?(
    hookContext: HookContext<T>
  ): Decision | undefined | Promise<Decision | undefined>
  after?(hookContext: HookContext<T>, decision: Decision): void | Promise<void>
  error?(hookContext: HookContext<T>, error: unknown): void | Promise<void>
  finally?(hookContext: HookContext<T>): void | Promise<void>
}

export type GatedConfig<TIdentity extends Identity = Identity> = {
  identify: () => Promise<TIdentity | null>
  decide: (key: string, identity: TIdentity) => Promise<Decision>
  hooks?: Hook<TIdentity>[]
}
