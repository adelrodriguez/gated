import { type ReactNode, Suspense, use } from "react"
import type { GateEvaluator, Identity } from "../lib/types"

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_IDENTITY_KEY = ""

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
  expiresAt: number
  promise: Promise<TValue>
}

function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`)
  }
}

/**
 * Creates a bounded promise cache for a React gate.
 *
 * Create one cache per server request. Sharing a cache across requests can retain identities and
 * stale decisions across users.
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

      if (Date.now() >= entry.expiresAt) {
        entries.delete(key)
        return undefined
      }

      entries.delete(key)
      entries.set(key, entry)
      return entry.promise
    },
    set(key, promise): void {
      entries.delete(key)

      while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        entries.delete(oldestKey)
      }

      entries.set(key, {
        expiresAt: Date.now() + ttlMs,
        promise,
      })
    },
  }
}

function identityKey(identity?: Identity): string {
  if (identity === undefined) {
    return DEFAULT_IDENTITY_KEY
  }

  const sortedIdentity = Object.fromEntries(
    Object.keys(identity)
      .toSorted()
      .map((key) => [key, identity[key]])
  )
  return JSON.stringify(sortedIdentity)
}

function isDevelopmentEnvironment(): boolean {
  const runtimeProcess: unknown = Reflect.get(globalThis, "process")
  if (typeof runtimeProcess !== "object" || runtimeProcess === null) {
    return false
  }

  const runtimeEnvironment: unknown = Reflect.get(runtimeProcess, "env")
  if (typeof runtimeEnvironment !== "object" || runtimeEnvironment === null) {
    return false
  }

  return Reflect.get(runtimeEnvironment, "NODE_ENV") !== "production"
}

/**
 * Creates a React hook backed by a bounded promise cache.
 *
 * Components calling the returned hook must be inside a Suspense boundary. Cache invalidation and
 * expiry take effect on the next render; they do not schedule a render themselves.
 */
export function createReactGate<TIdentity extends Identity, TValue extends boolean | string>(
  gateFn: GateEvaluator<TIdentity, TValue>,
  options: ReactGateCacheOptions & { cache?: ReactGateCache<TValue> } = {}
): ReactGate<TIdentity, TValue> {
  const cache = options.cache ?? createReactGateCache<TValue>(options)

  function useGateValue(overrideIdentity?: TIdentity): TValue {
    const key = identityKey(overrideIdentity)
    let promise = cache.get(key)

    if (!promise) {
      const evaluation = gateFn(overrideIdentity)
      const cachedEvaluation = evaluation.catch((error: unknown) => {
        setTimeout(() => {
          if (cache.get(key) === cachedEvaluation) {
            cache.delete(key)
          }
        }, 0)
        throw error
      })
      cache.set(key, cachedEvaluation)
      promise = cachedEvaluation
    }

    return use(promise)
  }

  useGateValue.invalidate = (overrideIdentity?: TIdentity): void => {
    cache.delete(identityKey(overrideIdentity))
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
  return (
    <Suspense fallback={loading}>
      <GateSlot {...slotProps} />
    </Suspense>
  )
}
