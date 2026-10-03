import type { Decision } from "./decision"
import type { Hook, HookContext, HookErrorReport } from "./hook"
import type { Identity } from "./identity"
import type { MaybePromise } from "./utility"

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

export type DecisionCacheErrorReport<TIdentity extends Identity = Identity> = {
  operation: "key" | "get" | "set" | "delete" | "validate" | "subscribe"
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

export type GatedConfig<TIdentity extends Identity = Identity> = {
  anonymous?: "reject"
  cache?: DecisionCache
  /**
   * Concurrent evaluations with one evaluation key share a single provider call. Enabled by
   * default; set `false` when `decide` has per-call side effects such as exposure logging. Track
   * exposures in hooks to keep per-evaluation observability with coalescing enabled.
   */
  coalesce?: boolean
  /**
   * Projects an evaluation context to its evaluation key — the collision-safe string that
   * identifies interchangeable evaluations. Used as the cache store key and the coalescing key. The
   * default key uses the flag key, the gate shape, and the type and value of
   * `identity.distinctId`.
   */
  evaluationKey?: (context: HookContext<TIdentity>) => string
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
  /**
   * Attaches to provider flag changes and returns a detach function. A gate factory attaches it at
   * most once at a time and shares that attachment between invalidation and `changes` listeners. A
   * factory with a cache or request coalescing stays attached after its first evaluation. A factory
   * that only `changes` listeners use detaches when the last listener leaves.
   */
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

export type AnyGatedConfig<TIdentity extends Identity> =
  | GatedConfig<TIdentity>
  | AnonymousGatedConfig<TIdentity>
  | CallerIdentityGatedConfig<TIdentity>
