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

export type GateEvaluator<TIdentity extends Identity, TValue extends boolean | string> = (
  overrideIdentity?: TIdentity
) => Promise<TValue>

export type MaybePromise<T> = T | Promise<T>

export type HookContext<
  TIdentity extends Identity = Identity,
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> = {
  flagKey: string
  identity: TIdentity | null
} & TOptions

export type DecisionSource = "hook" | "provider"

export type AfterHookMeta<TIdentity extends Identity = Identity> =
  | { source: "hook"; resolver: Hook<TIdentity> }
  | { source: "provider" }

export interface Hook<T extends Identity = Identity> {
  before?(hookContext: HookContext<T>): MaybePromise<void>
  resolve?(hookContext: HookContext<T>): MaybePromise<Decision | null | undefined>
  after?(
    hookContext: HookContext<T>,
    decision: Decision,
    meta: AfterHookMeta<T>
  ): MaybePromise<void>
  error?(hookContext: HookContext<T>, error: unknown): MaybePromise<void>
  finally?(hookContext: HookContext<T>): MaybePromise<void>
}

export type GatedConfig<TIdentity extends Identity = Identity> = {
  identify: () => MaybePromise<TIdentity | null>
  decide: (key: string, identity: TIdentity) => MaybePromise<Decision>
  hooks?: Array<Hook<TIdentity>>
}
