/**
 * The identity of the user for evaluation of the flags
 */
export type IdentityValue = bigint | boolean | number | object | string | symbol | null | undefined

export type Identity = {
  /**
   * A unique identifier for the user
   */
  distinctId: string | number
} & Record<string, IdentityValue>

export type Decision =
  | {
      type: "boolean"
      value: boolean
    }
  | {
      type: "variant"
      variant: string
      payload?: IdentityValue
    }

type EvaluationDetailsBase<TValue> = {
  value: TValue
  flagKey: string
  /**
   * Present only when a successful variant decision includes provider metadata.
   */
  payload?: IdentityValue
}

export type EvaluationDetails<TValue> = EvaluationDetailsBase<TValue> &
  (
    | { source: DecisionSource; error?: never }
    | {
        source: "default"
        /**
         * The failure that caused evaluation to use the configured default.
         */
        error: Error
      }
  )

export type GateCallOptions<TIdentity extends Identity> = {
  identity?: TIdentity
  signal?: AbortSignal
}

export type GateEvaluator<TIdentity extends Identity, TValue extends boolean | string> = ((
  options?: GateCallOptions<TIdentity>
) => Promise<TValue>) & {
  details: (options?: GateCallOptions<TIdentity>) => Promise<EvaluationDetails<TValue>>
}

export type MaybePromise<T> = T | Promise<T>

type HookContextBase<TIdentity extends Identity> = {
  readonly flagKey: string
  readonly identity: TIdentity | null
  readonly signal: AbortSignal
}

export type HookContext<TIdentity extends Identity = Identity> = HookContextBase<TIdentity> &
  (
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

export type DecisionSource = "hook" | "provider"

export type AfterHookMeta<TIdentity extends Identity = Identity> =
  | { source: "hook"; resolver: Hook<TIdentity> }
  | { source: "provider" }

export type HookErrorReport<TIdentity extends Identity = Identity> = {
  phase: "before" | "resolve" | "after" | "error" | "finally"
  hookIndex: number
  error: Error
  context: HookContext<TIdentity>
}

export interface Hook<T extends Identity = Identity> {
  before?(hookContext: HookContext<T>): MaybePromise<void>
  resolve?(hookContext: HookContext<T>): MaybePromise<Decision | null | undefined>
  after?(
    hookContext: HookContext<T>,
    decision: Decision,
    meta: AfterHookMeta<T>
  ): MaybePromise<void>
  error?(hookContext: HookContext<T>, error: Error): MaybePromise<void>
  finally?(hookContext: HookContext<T>): MaybePromise<void>
}

export type GatedConfig<TIdentity extends Identity = Identity> = {
  anonymous?: "reject"
  identify: () => MaybePromise<TIdentity | null>
  decide: (
    key: string,
    identity: TIdentity,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Decision>
  hooks?: Array<Hook<TIdentity>>
  onHookError?: (report: HookErrorReport<TIdentity>) => MaybePromise<void>
  timeoutMs?: number
}

export type AnonymousGatedConfig<TIdentity extends Identity = Identity> = Omit<
  GatedConfig<TIdentity>,
  "anonymous" | "decide"
> & {
  anonymous: "allow"
  decide: (
    key: string,
    identity: TIdentity | null,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Decision>
}
