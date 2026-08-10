/**
 * A supported identity attribute value.
 */
export type IdentityValue = bigint | boolean | number | object | string | symbol | null | undefined

export type Identity = {
  /**
   * A unique identifier for the user
   */
  distinctId: string | number
} & Record<string, IdentityValue>

export type Decision<TPayload = unknown> =
  | {
      type: "boolean"
      value: boolean
    }
  | {
      type: "variant"
      variant: string
      payload?: TPayload
    }

type EvaluationDetailsBase<TValue> = {
  value: TValue
  flagKey: string
}

type EvaluationDetailsPayload<TValue, TPayload> = [Extract<TValue, string>] extends [never]
  ? Record<never, never>
  : {
      /**
       * Present only when a successful variant decision includes provider metadata.
       */
      payload?: TPayload
    }

export type EvaluationDetails<TValue, TPayload = unknown> = EvaluationDetailsBase<TValue> &
  EvaluationDetailsPayload<TValue, TPayload> &
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

export type GateCallOptions<TIdentity extends Identity | null> = {
  identity?: TIdentity
  signal?: AbortSignal
}

type RequiredGateCallOptions<TIdentity extends Identity> = Omit<
  GateCallOptions<TIdentity>,
  "identity"
> & {
  identity: TIdentity
}

type GateCallArguments<
  TCallIdentity extends Identity | null,
  TCallRequired extends boolean,
> = TCallRequired extends true
  ? [options: RequiredGateCallOptions<Extract<TCallIdentity, Identity>>]
  : [options?: GateCallOptions<TCallIdentity>]

export type GateEvaluator<
  TIdentity extends Identity,
  TValue extends boolean | string,
  TCallIdentity extends TIdentity | null = TIdentity,
  TPayload = unknown,
  TCallRequired extends boolean = false,
> = ((...args: GateCallArguments<TCallIdentity, TCallRequired>) => Promise<TValue>) & {
  details: (
    ...args: GateCallArguments<TCallIdentity, TCallRequired>
  ) => Promise<EvaluationDetails<TValue, TPayload>>
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

export type CoalescingOptions<TIdentity extends Identity = Identity> = {
  /**
   * Projects an evaluation context to its coalescing key. The default key uses the flag key and the
   * type and value of `identity.distinctId`.
   */
  key?: (context: HookContext<TIdentity>) => string
}

/**
 * A cache store for decisions. The store owns serialization and expiry policy.
 *
 * Variant payloads can contain values that are not JSON-safe. A persistent store must preserve them
 * or normalize them for the provider.
 */
export type DecisionCache = {
  delete?(key: string): Promise<boolean | undefined>
  get(key: string): Promise<Decision | null | undefined>
  set(key: string, value: Decision): Promise<void>
}

export type DecisionCacheOptions<TIdentity extends Identity = Identity> = {
  /**
   * Projects an evaluation context to its cache key. The default is the coalescing key.
   */
  key?: (context: HookContext<TIdentity>) => string
  store: DecisionCache
}

export type DecisionSource = "cache" | "provider"

export type HookErrorReport<TIdentity extends Identity = Identity> = {
  phase: "before" | "after" | "error" | "finally"
  hookIndex: number
  error: Error
  context: HookContext<TIdentity>
}

export type DecisionCacheErrorReport<TIdentity extends Identity = Identity> = {
  operation: "key" | "get" | "set" | "delete" | "validate"
  key: string
  flagKey: string
  identity: TIdentity | null
  error: Error
}

export type GateChange = {
  keys?: readonly string[]
}

export type GateChanges = {
  subscribe(listener: (keys?: readonly string[]) => void): () => void
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

export type GatedConfig<TIdentity extends Identity = Identity> = {
  anonymous?: "reject"
  cache?: DecisionCache | DecisionCacheOptions<TIdentity>
  coalesce?: boolean | CoalescingOptions<TIdentity>
  identify: () => MaybePromise<TIdentity | null>
  decide: (
    key: string,
    identity: TIdentity,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Decision>
  decideMany?: (
    keys: readonly string[],
    identity: TIdentity,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Record<string, Decision>>
  hooks?: Array<Hook<TIdentity>>
  onCacheError?: (report: DecisionCacheErrorReport<TIdentity>) => MaybePromise<void>
  onHookError?: (report: HookErrorReport<TIdentity>) => MaybePromise<void>
  subscribe?: (notify: (change: GateChange) => void) => () => void
  timeoutMs?: number
}

export type AnonymousGatedConfig<TIdentity extends Identity = Identity> = Omit<
  GatedConfig<TIdentity>,
  "anonymous" | "decide" | "decideMany"
> & {
  anonymous: "allow"
  decide: (
    key: string,
    identity: TIdentity | null,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Decision>
  decideMany?: (
    keys: readonly string[],
    identity: TIdentity | null,
    options?: { signal?: AbortSignal }
  ) => MaybePromise<Record<string, Decision>>
}

export type CallerIdentityGatedConfig<TIdentity extends Identity = Identity> = Omit<
  GatedConfig<TIdentity>,
  "anonymous" | "identify"
> & {
  anonymous?: never
  identify?: never
}
