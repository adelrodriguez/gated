export * from "./key"

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000

export type GateCacheOptions = {
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

export interface GateCache<TValue extends boolean | string = boolean | string> {
  clear(): void
  delete(key: string): boolean
  get(key: string): Promise<TValue> | undefined
  set(key: string, promise: Promise<TValue>): void
}

type CacheEntry<TValue extends boolean | string> = {
  expiresAt: number | undefined
  pendingExpiresAt: number | undefined
  promise: Promise<TValue>
  settled: boolean
}

export async function evictOnRejection<T>(
  evaluation: Promise<T>,
  onRejected: () => void
): Promise<T> {
  try {
    return await evaluation
  } catch (error) {
    onRejected()
    throw error
  }
}

/**
 * Creates a bounded promise cache for gate evaluations.
 *
 * Pending evaluations are pinned by default so TTL/LRU pressure cannot evict an in-flight
 * evaluation out from under a waiting consumer. When pendingTtlMs is set, older pending entries can
 * be pruned without cancelling their work. Create one cache per server request; sharing one across
 * requests can retain identities and stale decisions across users.
 */
export function createGateCache<TValue extends boolean | string = boolean | string>({
  maxEntries = DEFAULT_MAX_ENTRIES,
  pendingTtlMs,
  ttlMs = DEFAULT_TTL_MS,
}: GateCacheOptions = {}): GateCache<TValue> {
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
    throw new RangeError("maxEntries must be a positive finite number")
  }
  if (pendingTtlMs !== undefined && (!Number.isFinite(pendingTtlMs) || pendingTtlMs <= 0)) {
    throw new RangeError("pendingTtlMs must be a positive finite number")
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive finite number")
  }

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
          // Let consumers retry suspended renders before settled overflow entries become evictable.
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
