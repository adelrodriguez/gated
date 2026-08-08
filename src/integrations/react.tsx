import { type ReactNode, Suspense, use } from "react"
import type { GateEvaluator, Identity } from "../lib/types"

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_IDENTITY_KEY = ""
let nextReactGateNamespace = 0

export type ReactGateCacheOptions = {
  /**
   * Maximum number of identities retained by the cache. Defaults to 100.
   */
  maxEntries?: number
  /**
   * Time in milliseconds that an evaluation remains cached. Defaults to five minutes.
   */
  ttlMs?: number
}

export type CreateReactGateOptions<TValue extends boolean | string> =
  | (ReactGateCacheOptions & { cache?: undefined })
  | {
      /**
       * Injected caches own their bounds; maxEntries and ttlMs cannot also be supplied.
       */
      cache: ReactGateCache<TValue>
      maxEntries?: never
      ttlMs?: never
    }

export interface ReactGateCache<TValue extends boolean | string = boolean | string> {
  clear(): void
  delete(key: string): boolean
  get(key: string): Promise<TValue> | undefined
  set(key: string, promise: Promise<TValue>): void
}

export type ReactGate<TIdentity extends Identity, TValue extends boolean | string> = {
  (overrideIdentity?: TIdentity): TValue
  /**
   * Evicts one identity. The next render evaluates it again; this does not trigger a render.
   */
  invalidate(overrideIdentity?: TIdentity): void
  /**
   * Evicts every identity. The next render evaluates them again; this does not trigger a render.
   */
  clear(): void
}

type CacheEntry<TValue extends boolean | string> = {
  expiresAt: number | undefined
  promise: Promise<TValue>
  settled: boolean
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
 * Pending evaluations are pinned so TTL/LRU pressure cannot create repeated Suspense retries. The
 * cache may temporarily exceed maxEntries while evaluations are pending, then returns to its bound
 * after they settle. Create one cache per server request; sharing one across requests can retain
 * identities and stale decisions across users.
 */
export function createReactGateCache<TValue extends boolean | string = boolean | string>({
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
}: ReactGateCacheOptions = {}): ReactGateCache<TValue> {
  assertPositiveNumber(maxEntries, "maxEntries")
  assertPositiveNumber(ttlMs, "ttlMs")

  if (!Number.isInteger(maxEntries)) {
    throw new RangeError("maxEntries must be an integer")
  }

  const entries = new Map<string, CacheEntry<TValue>>()

  function pruneEntries(): void {
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.settled && entry.expiresAt !== undefined && now >= entry.expiresAt) {
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

      if (entry.settled && entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
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
        promise,
        settled: false,
      }
      entries.set(key, entry)
      pruneEntries()

      void promise.then(
        () => {
          entry.expiresAt = Date.now() + ttlMs
          entry.settled = true
          // Let React retry suspended renders before settled overflow entries become evictable.
          setTimeout(pruneEntries, 0)
          return null
        },
        () => {
          entry.expiresAt = Date.now() + ttlMs
          entry.settled = true
          setTimeout(pruneEntries, 0)
          return null
        }
      )
    },
  }
}

function identityKey(identity?: Identity): string {
  if (identity === undefined) {
    return DEFAULT_IDENTITY_KEY
  }

  const keys = Object.keys(identity)
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys returns a fresh array; sort has broader runtime support than toSorted.
  keys.sort()
  const sortedIdentity = Object.fromEntries(keys.map((key) => [key, identity[key]]))
  return JSON.stringify(sortedIdentity)
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
  gateFn: GateEvaluator<TIdentity, TValue>,
  options: CreateReactGateOptions<TValue> = {}
): ReactGate<TIdentity, TValue> {
  const runtimeOptions = options as ReactGateCacheOptions & {
    cache?: ReactGateCache<TValue>
  }
  if (
    runtimeOptions.cache !== undefined &&
    (runtimeOptions.maxEntries !== undefined || runtimeOptions.ttlMs !== undefined)
  ) {
    throw new TypeError("An injected cache cannot be combined with maxEntries or ttlMs")
  }

  const cache = runtimeOptions.cache ?? createReactGateCache<TValue>(runtimeOptions)
  const cacheNamespace = `gate:${nextReactGateNamespace}:`
  nextReactGateNamespace += 1
  const keyOf = (overrideIdentity?: TIdentity): string =>
    cacheNamespace + identityKey(overrideIdentity)

  function useGateValue(overrideIdentity?: TIdentity): TValue {
    const key = keyOf(overrideIdentity)
    let promise = cache.get(key)

    if (!promise) {
      const evaluation = gateFn(overrideIdentity)
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

  useGateValue.invalidate = (overrideIdentity?: TIdentity): void => {
    cache.delete(keyOf(overrideIdentity))
  }
  useGateValue.clear = (): void => {
    cache.clear()
  }

  return useGateValue
}

type GateSlotProps<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => boolean | string,
> = {
  children: ReactNode
  fallback?: ReactNode
  gate: TGate
  match?: ReturnType<TGate>
  overrideIdentity?: TIdentity
}

function GateSlot<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => boolean | string,
>({
  children,
  fallback,
  gate,
  match,
  overrideIdentity,
}: GateSlotProps<TIdentity, TGate>): ReactNode {
  const value = gate(overrideIdentity)

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
  gate: (overrideIdentity?: TIdentity) => boolean
  loading?: ReactNode
  match?: boolean
  overrideIdentity?: TIdentity
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => string,
>(props: {
  children: ReactNode
  fallback?: ReactNode
  gate: TGate
  loading?: ReactNode
  match: ReturnType<TGate>
  overrideIdentity?: TIdentity
}): ReactNode
export function FeatureGate<
  TIdentity extends Identity,
  TGate extends (overrideIdentity?: TIdentity) => boolean | string,
>({ loading, ...slotProps }: GateSlotProps<TIdentity, TGate> & { loading?: ReactNode }): ReactNode {
  const slot = <GateSlot {...slotProps} />
  if (loading === undefined) {
    return slot
  }

  return <Suspense fallback={loading}>{slot}</Suspense>
}
