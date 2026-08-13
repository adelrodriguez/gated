export * from "./key"

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
