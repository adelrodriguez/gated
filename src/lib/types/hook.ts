import type { Decision, DecisionSource } from "./decision"
import type { Identity } from "./identity"
import type { MaybePromise } from "./utility"

type HookContextBase<TIdentity extends Identity> = {
  readonly flagKey: string
  readonly identity: TIdentity | null
  readonly signal: AbortSignal
}

export type HookContext<TIdentity extends Identity = Identity> = HookContextBase<TIdentity>
  & (
    | {
        readonly defaultValue: boolean
        readonly kind: "boolean"
        readonly variants?: undefined
      }
    | {
        readonly defaultValue: string
        readonly kind: "variant"
        readonly variants: readonly string[]
      }
  )

export type HookErrorReport<TIdentity extends Identity = Identity> = {
  phase: "before" | "after" | "error" | "finally"
  hookIndex: number
  error: Error
  context: HookContext<TIdentity>
}

export interface Hook<T extends Identity = Identity> {
  before?(hookContext: HookContext<T>): MaybePromise<void>
  after?(
    hookContext: HookContext<T>,
    decision: Decision,
    meta: { source: DecisionSource }
  ): MaybePromise<void>
  error?(hookContext: HookContext<T>, error: Error): MaybePromise<void>
  finally?(hookContext: HookContext<T>): MaybePromise<void>
}
