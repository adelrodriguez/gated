import { createContext, type ReactNode, Suspense, use, useSyncExternalStore } from "react"
import type { GateCallOptions, GateChanges, Identity } from "../lib/types"
import { getEvaluatorFlagKey } from "../lib/evaluator"

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000
let nextReactGateNamespace = 0
let didWarnAboutServerDefaultCache = false

export type ReactGateCacheOptions = {
  /**
   * Maximum number of identities retained by the cache. Defaults to 100.
   */
  maxEntries?: number
  /**
   * Time in milliseconds before a pending evaluation can be evicted. Disabled by default.
   */
  pendingTtlMs?: number
  /**
   * Time in milliseconds that an evaluation remains cached. Defaults to five minutes.
   */
  ttlMs?: number
}

export type CreateReactGateOptions<TValue extends boolean | string> =
  | (ReactGateCacheOptions & { cache?: undefined; changes?: GateChanges })
  | {
      /**
       * Injected caches own their bounds; maxEntries and ttlMs cannot also be supplied.
       */
      cache: ReactGateCache<TValue>
      changes?: GateChanges
      maxEntries?: never
      pendingTtlMs?: never
      ttlMs?: never
    }

export type ReactGateCacheKey =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly ReactGateCacheKey[]
  | { readonly [key: string]: ReactGateCacheKey }

export type CustomCreateReactGateOptions<
  TArgs extends unknown[],
  TValue extends boolean | string,
> = CreateReactGateOptions<TValue> & {
  /**
   * Projects the function arguments to the semantic value used for cache lookup and invalidation.
   */
  cacheKey: (...args: TArgs) => ReactGateCacheKey
}

export interface ReactGateCache<TValue extends boolean | string = boolean | string> {
  clear(): void
  delete(key: string): boolean
  get(key: string): Promise<TValue> | undefined
  set(key: string, promise: Promise<TValue>): void
}

const GateCacheContext = createContext<ReactGateCache | undefined>(undefined)

export function GateCacheProvider({
  cache,
  children,
}: {
  cache: ReactGateCache
  children: ReactNode
}): ReactNode {
  return <GateCacheContext value={cache}>{children}</GateCacheContext>
}

export type ReactGate<TIdentity extends Identity, TValue extends boolean | string> = {
  (identity?: TIdentity): TValue
  /**
   * Evicts one identity. The next render evaluates it again; this does not trigger a render.
   */
  invalidate(identity?: TIdentity): void
  /**
   * Evicts every identity. The next render evaluates them again; this does not trigger a render.
   */
  clear(): void
}

export type CustomReactGate<TArgs extends unknown[], TValue extends boolean | string> = {
  (...args: TArgs): TValue
  /**
   * Evicts one invocation. The next render evaluates it again; this does not trigger a render.
   */
  invalidate(...args: TArgs): void
  /**
   * Evicts one projected cache key without requiring the full invocation arguments.
   */
  invalidateKey(key: ReactGateCacheKey): void
  /**
   * Evicts every invocation. The next render evaluates them again; this does not trigger a render.
   */
  clear(): void
}

type CacheEntry<TValue extends boolean | string> = {
  expiresAt: number | undefined
  pendingExpiresAt: number | undefined
  promise: Promise<TValue>
  settled: boolean
}

type ReactGateVersionStore = {
  bump: () => void
  getSnapshot: () => number
  subscribe: (listener: () => void) => () => void
}

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`)
  }
}

async function evictOnRejection<T>(evaluation: Promise<T>, onRejected: () => void): Promise<T> {
  try {
    return await evaluation
  } catch (error) {
    onRejected()
    throw error
  }
}

/**
 * Creates a bounded promise cache for React gates.
 *
 * Pending evaluations are pinned by default so TTL/LRU pressure cannot create repeated Suspense
 * retries. When pendingTtlMs is set, older pending entries can be pruned without cancelling their
 * work. Create one cache per server request; sharing one across requests can retain identities and
 * stale decisions across users.
 */
export function createReactGateCache<TValue extends boolean | string = boolean | string>({
  maxEntries = DEFAULT_MAX_ENTRIES,
  pendingTtlMs,
  ttlMs = DEFAULT_TTL_MS,
}: ReactGateCacheOptions = {}): ReactGateCache<TValue> {
  assertPositiveNumber(maxEntries, "maxEntries")
  if (pendingTtlMs !== undefined) {
    assertPositiveNumber(pendingTtlMs, "pendingTtlMs")
  }
  assertPositiveNumber(ttlMs, "ttlMs")

  if (!Number.isInteger(maxEntries)) {
    throw new RangeError("maxEntries must be an integer")
  }

  const entries = new Map<string, CacheEntry<TValue>>()

  function pruneEntries(): void {
    const now = Date.now()
    for (const [key, entry] of entries) {
      const pendingExpired =
        !entry.settled && entry.pendingExpiresAt !== undefined && now >= entry.pendingExpiresAt
      const settledExpired =
        entry.settled && entry.expiresAt !== undefined && now >= entry.expiresAt
      if (pendingExpired || settledExpired) {
        entries.delete(key)
      }
    }

    while (entries.size > maxEntries) {
      let evicted = false
      for (const [key, entry] of entries) {
        if (entry.settled) {
          entries.delete(key)
          evicted = true
          break
        }
      }
      if (!evicted) {
        break
      }
    }
  }

  return {
    clear(): void {
      entries.clear()
    },
    delete(key): boolean {
      return entries.delete(key)
    },
    get(key): Promise<TValue> | undefined {
      const entry = entries.get(key)
      if (!entry) {
        return undefined
      }

      const now = Date.now()
      const pendingExpired =
        !entry.settled && entry.pendingExpiresAt !== undefined && now >= entry.pendingExpiresAt
      const settledExpired =
        entry.settled && entry.expiresAt !== undefined && now >= entry.expiresAt
      if (pendingExpired || settledExpired) {
        entries.delete(key)
        return undefined
      }

      entries.delete(key)
      entries.set(key, entry)
      return entry.promise
    },
    set(key, promise): void {
      entries.delete(key)
      const entry: CacheEntry<TValue> = {
        expiresAt: undefined,
        pendingExpiresAt: pendingTtlMs === undefined ? undefined : Date.now() + pendingTtlMs,
        promise,
        settled: false,
      }
      entries.set(key, entry)
      pruneEntries()

      void promise.then(
        () => {
          entry.expiresAt = Date.now() + ttlMs
          entry.pendingExpiresAt = undefined
          entry.settled = true
          // Let React retry suspended renders before settled overflow entries become evictable.
          setTimeout(pruneEntries, 0)
          return null
        },
        () => {
          entry.expiresAt = Date.now() + ttlMs
          entry.pendingExpiresAt = undefined
          entry.settled = true
          setTimeout(pruneEntries, 0)
          return null
        }
      )
    },
  }
}

function stableSerialize(value: unknown, rootPath: "cacheKey" | "identity"): string {
  const ancestors = new Set<object>()

  function unsupported(path: string, kind: string): never {
    const identityRemedy =
      rootPath === "identity" ? " Change identify() to return supported cache-key values." : ""
    throw new TypeError(
      `Unsupported React gate cache key at ${path}: ${kind} is not supported.${identityRemedy}`
    )
  }

  function encode(current: unknown, path: string): string {
    if (current === null) {
      return "null"
    }

    switch (typeof current) {
      case "undefined":
        return "undefined"
      case "boolean":
        return `boolean:${current}`
      case "number":
        return `number:${Object.is(current, -0) ? "-0" : String(current)}`
      case "string":
        return `string:${JSON.stringify(current)}`
      case "bigint":
        return unsupported(path, "bigint")
      case "symbol":
        return unsupported(path, "symbol")
      case "function":
        return unsupported(path, "function")
      case "object": {
        const prototype = Object.getPrototypeOf(current)
        if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
          const constructor = (prototype as { constructor?: unknown }).constructor
          const kind =
            typeof constructor === "function" && constructor.name
              ? constructor.name
              : "non-plain object"
          return unsupported(path, kind)
        }

        if (ancestors.has(current)) {
          return unsupported(path, "circular reference")
        }

        ancestors.add(current)
        try {
          if (Array.isArray(current)) {
            return `array:[${current
              .map((item, index) => encode(item, `${path}[${index}]`))
              .join(",")}]`
          }

          const keys = Object.keys(current)
          // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys returns a fresh array; sort has broader runtime support than toSorted.
          keys.sort()
          const entries = keys.map(
            (key) =>
              `${JSON.stringify(key)}:${encode(
                (current as Record<string, unknown>)[key],
                `${path}.${key}`
              )}`
          )
          return `object:{${entries.join(",")}}`
        } finally {
          ancestors.delete(current)
        }
      }
    }

    throw new TypeError("Unsupported React gate cache key")
  }

  return encode(value, rootPath)
}

function trimTrailingUndefined(args: unknown[]): unknown[] {
  const normalized = [...args]
  while (normalized.length > 0 && normalized.at(-1) === undefined) {
    normalized.pop()
  }
  return normalized
}

function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV !== "production"
}

/**
 * Creates a React hook backed by a bounded promise cache.
 *
 * Components calling the returned hook must be inside a Suspense boundary. Cache invalidation and
 * expiry take effect on the next render; they do not schedule a render themselves.
 */
export function createReactGate<TIdentity extends Identity, TValue extends boolean | string>(
  gateFn: (options?: GateCallOptions<TIdentity>) => Promise<TValue>,
  options?: CreateReactGateOptions<TValue>
): ReactGate<TIdentity, TValue>
export function createReactGate<TArgs extends unknown[], TValue extends boolean | string>(
  gateFn: (...args: TArgs) => Promise<TValue>,
  options: CustomCreateReactGateOptions<TArgs, TValue>
): CustomReactGate<TArgs, TValue>
export function createReactGate<TValue extends boolean | string>(
  gateFn: (...args: never[]) => Promise<TValue>,
  options: CreateReactGateOptions<TValue> & {
    cacheKey?: (...args: never[]) => ReactGateCacheKey
  } = {}
): ReactGate<Identity, TValue> | CustomReactGate<never[], TValue> {
  const runtimeOptions = options as ReactGateCacheOptions & {
    cache?: ReactGateCache<TValue>
    cacheKey?: (...args: unknown[]) => ReactGateCacheKey
    changes?: GateChanges
  }
  if (
    runtimeOptions.cache !== undefined &&
    (runtimeOptions.maxEntries !== undefined ||
      runtimeOptions.pendingTtlMs !== undefined ||
      runtimeOptions.ttlMs !== undefined)
  ) {
    throw new TypeError(
      "An injected cache cannot be combined with maxEntries, pendingTtlMs, or ttlMs"
    )
  }

  const defaultCache = runtimeOptions.cache ?? createReactGateCache<TValue>(runtimeOptions)
  const evaluatorFlagKey = getEvaluatorFlagKey(gateFn)
  const cacheNamespace = `gate:${nextReactGateNamespace}:`
  nextReactGateNamespace += 1
  const storesByCache = new WeakMap<ReactGateCache<TValue>, Map<string, ReactGateVersionStore>>()
  const activeStores = new Set<ReactGateVersionStore>()
  let detachChanges: (() => void) | undefined

  const attachStore = (store: ReactGateVersionStore): void => {
    activeStores.add(store)
    if (activeStores.size === 1 && runtimeOptions.changes) {
      detachChanges = runtimeOptions.changes.subscribe((changedFlagKeys) => {
        if (
          changedFlagKeys !== undefined &&
          evaluatorFlagKey !== undefined &&
          !changedFlagKeys.includes(evaluatorFlagKey)
        ) {
          return
        }
        for (const activeStore of activeStores) {
          activeStore.bump()
        }
      })
    }
  }

  const detachStore = (store: ReactGateVersionStore): void => {
    activeStores.delete(store)
    if (activeStores.size === 0) {
      detachChanges?.()
      detachChanges = undefined
    }
  }

  const getVersionStore = (cache: ReactGateCache<TValue>, key: string): ReactGateVersionStore => {
    let stores = storesByCache.get(cache)
    if (!stores) {
      stores = new Map()
      storesByCache.set(cache, stores)
    }
    const existing = stores.get(key)
    if (existing) {
      return existing
    }

    let version = 0
    const listeners = new Set<() => void>()
    const store: ReactGateVersionStore = {
      bump: () => {
        cache.delete(key)
        version += 1
        for (const listener of listeners) {
          listener()
        }
      },
      getSnapshot: () => version,
      subscribe: (listener) => {
        listeners.add(listener)
        if (listeners.size === 1) {
          attachStore(store)
        }
        let attached = true
        return () => {
          if (!attached) {
            return
          }
          attached = false
          listeners.delete(listener)
          if (listeners.size === 0) {
            detachStore(store)
          }
        }
      },
    }
    stores.set(key, store)
    return store
  }
  const keyOf = (args: unknown[]): string => {
    const normalizedArgs = trimTrailingUndefined(args)
    const semanticKey = runtimeOptions.cacheKey
      ? runtimeOptions.cacheKey(...normalizedArgs)
      : (normalizedArgs[0] ?? null)
    return (
      cacheNamespace +
      stableSerialize(semanticKey, runtimeOptions.cacheKey ? "cacheKey" : "identity")
    )
  }

  function useGateValue(...args: unknown[]): TValue {
    const providerCache = use(GateCacheContext) as ReactGateCache<TValue> | undefined
    const cache = runtimeOptions.cache ?? providerCache ?? defaultCache
    if (
      runtimeOptions.cache === undefined &&
      providerCache === undefined &&
      !didWarnAboutServerDefaultCache &&
      isDevelopmentEnvironment() &&
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM types include window, but server runtimes do not.
      globalThis.window === undefined
    ) {
      // oxlint-disable-next-line react/react-compiler -- Effects do not run during server rendering; this one-time diagnostic must be emitted while rendering.
      didWarnAboutServerDefaultCache = true
      // oxlint-disable-next-line no-console -- Development-only warning for server cache isolation.
      console.error(
        "createReactGate is using its module-scope default cache during server rendering. Wrap the app in GateCacheProvider with a per-request cache."
      )
    }
    const key = keyOf(args)
    const versionStore = getVersionStore(cache, key)
    useSyncExternalStore(versionStore.subscribe, versionStore.getSnapshot, versionStore.getSnapshot)
    let promise = cache.get(key)

    if (!promise) {
      const evaluation = runtimeOptions.cacheKey
        ? gateFn(...(args as never[]))
        : args[0] === undefined
          ? gateFn()
          : gateFn({ identity: args[0] } as never)
      // React must observe the rejected promise on its retry render. Defer eviction until the
      // next task, and do not delete a newer evaluation that reused this key in the meantime.
      const cachedEvaluation = evictOnRejection(evaluation, () => {
        setTimeout(() => {
          if (cache.get(key) === cachedEvaluation) {
            cache.delete(key)
          }
        }, 0)
      })
      cache.set(key, cachedEvaluation)
      promise = cachedEvaluation
    }

    return use(promise)
  }

  useGateValue.invalidate = (...args: unknown[]): void => {
    defaultCache.delete(keyOf(args))
  }
  let customGate: CustomReactGate<never[], TValue> | undefined
  if (runtimeOptions.cacheKey) {
    customGate = useGateValue as unknown as CustomReactGate<never[], TValue>
    customGate.invalidateKey = (key): void => {
      defaultCache.delete(cacheNamespace + stableSerialize(key, "cacheKey"))
    }
  }
  useGateValue.clear = (): void => {
    defaultCache.clear()
  }

  return customGate ?? useGateValue
}

type GateSlotProps<
  TIdentity extends Identity,
  TGate extends (identity?: TIdentity) => boolean | string,
> = {
  children: ReactNode
  fallback?: ReactNode
  gate: TGate
  match?: ReturnType<TGate>
  identity?: TIdentity
}

function GateSlot<
  TIdentity extends Identity,
  TGate extends (identity?: TIdentity) => boolean | string,
>({ children, fallback, gate, match, identity }: GateSlotProps<TIdentity, TGate>): ReactNode {
  const value = gate(identity)

  if (typeof value === "string" && match === undefined) {
    if (isDevelopmentEnvironment()) {
      // oxlint-disable-next-line no-console -- Development-only warning for JavaScript misuse.
      console.error("FeatureGate requires a match prop when its gate returns a string variant.")
    }
    return fallback
  }

  const matchValue = match ?? true
  return value === matchValue ? children : fallback
}

export function FeatureGate<TIdentity extends Identity>(props: {
  children: ReactNode
  fallback?: ReactNode
  gate: (identity?: TIdentity) => boolean
  loading?: ReactNode
  match?: boolean
  identity?: TIdentity
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (identity?: TIdentity) => string,
>(props: {
  children: ReactNode
  fallback?: ReactNode
  gate: TGate
  loading?: ReactNode
  match: ReturnType<TGate>
  identity?: TIdentity
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (identity?: TIdentity) => boolean | string,
>({ loading, ...slotProps }: GateSlotProps<TIdentity, TGate> & { loading?: ReactNode }): ReactNode {
  const slot = <GateSlot {...slotProps} />
  if (loading === undefined) {
    return slot
  }

  return <Suspense fallback={loading}>{slot}</Suspense>
}
