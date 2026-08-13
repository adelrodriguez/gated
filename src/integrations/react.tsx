"use client"

import {
  createContext,
  type ReactNode,
  Suspense,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import type { EvaluationDetails, GateEvaluator, Identity } from "../lib/types"
import { evictOnRejection, type GateCacheOptions } from "../lib/cache"
import { type GateCacheKey, serializeKey } from "../lib/cache/key"
import { ForeignGateEvaluatorError } from "../lib/errors"
import { getEvaluatorFactoryRef, getEvaluatorFlagKey } from "../lib/evaluation/registry"
import { isDevelopmentEnvironment } from "../lib/utils"

type AnyGateEvaluator =
  | GateEvaluator<never, boolean | string, never>
  | GateEvaluator<never, boolean | string, never, unknown, true>

export type GateValueOf<TFlag> = TFlag extends (...args: never[]) => Promise<infer TValue>
  ? TValue
  : never
export type GateIdentityOf<TFlag> =
  TFlag extends GateEvaluator<
    infer TIdentity,
    boolean | string,
    infer TCallIdentity,
    unknown,
    infer _TRequired
  >
    ? TCallIdentity extends Identity
      ? TCallIdentity
      : TIdentity
    : never
export type GateDetailsOf<TFlag> = TFlag extends {
  details: (...args: never[]) => Promise<infer TDetails>
}
  ? TDetails
  : never
export type GateBatchValuesOf<TFlags extends readonly AnyGateEvaluator[]> = Readonly<{
  [K in keyof TFlags]: GateValueOf<TFlags[K]>
}>
export type GateBatchIdentityOf<TFlags extends readonly AnyGateEvaluator[]> = GateIdentityOf<
  TFlags[number]
>
export type ReactGateCacheKey = GateCacheKey
export type ReactGateCacheOptions = GateCacheOptions

type VersionStore = {
  bump: () => void
  getSnapshot: () => number
  subscribe: (listener: () => void) => () => void
}

type CacheEntry = {
  expiresAt?: number
  pendingExpiresAt?: number
  promise: Promise<unknown>
  settled: boolean
}

type Bucket = {
  entries: Map<string, CacheEntry>
  stores: Map<string, VersionStore>
}

export type ReactGateCache = {
  clear(): void
  invalidate<TFlag extends AnyGateEvaluator>(flag: TFlag, identity?: GateIdentityOf<TFlag>): void
  invalidateBatch<TFlags extends readonly AnyGateEvaluator[]>(
    flags: TFlags,
    identity?: GateBatchIdentityOf<TFlags>
  ): void
  invalidateKey(key: ReactGateCacheKey): void
  prefetch<TFlag extends AnyGateEvaluator>(
    flag: TFlag,
    options?: { identity?: GateIdentityOf<TFlag>; ttlMs?: number }
  ): Promise<void>
  prefetchBatch<TFlags extends readonly AnyGateEvaluator[]>(
    flags: TFlags,
    options?: { identity?: GateBatchIdentityOf<TFlags>; ttlMs?: number }
  ): Promise<void>
}

type InternalGateCache = ReactGateCache & {
  allBuckets: Set<Bucket>
  batchBuckets: WeakMap<object, Bucket>
  customBucket: Bucket
  gateBuckets: WeakMap<object, Bucket>
  options: Required<Pick<GateCacheOptions, "maxEntries" | "ttlMs">> &
    Pick<GateCacheOptions, "pendingTtlMs">
}

const IDENTIFY_SENTINEL = "identify:core"
const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000
const emptySnapshot = (): number => 0
const emptySubscribe = (): (() => null) => () => null
const EMPTY_VERSION_STORE: VersionStore = {
  bump: () => null,
  getSnapshot: emptySnapshot,
  subscribe: emptySubscribe,
}

function assertCacheOptions(options: GateCacheOptions): void {
  const { maxEntries = DEFAULT_MAX_ENTRIES, pendingTtlMs, ttlMs = DEFAULT_TTL_MS } = options
  if (!Number.isFinite(maxEntries) || maxEntries <= 0 || !Number.isInteger(maxEntries)) {
    throw new RangeError("maxEntries must be a positive finite integer")
  }
  if (pendingTtlMs !== undefined && (!Number.isFinite(pendingTtlMs) || pendingTtlMs <= 0)) {
    throw new RangeError("pendingTtlMs must be a positive finite number")
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive finite number")
  }
}

function createBucket(): Bucket {
  return { entries: new Map(), stores: new Map() }
}

function identityKey(identity: Identity | undefined): string {
  return identity === undefined ? IDENTIFY_SENTINEL : serializeKey(identity, "identity")
}

function batchKey(flags: readonly AnyGateEvaluator[], identity?: Identity): string {
  const keys = flags.map((flag) => getEvaluatorFlagKey(flag) ?? "")
  return serializeKey([keys, identityKey(identity)], "cacheKey")
}

function getBucket(cache: InternalGateCache, flag: object): Bucket {
  let bucket = cache.gateBuckets.get(flag)
  if (!bucket) {
    bucket = createBucket()
    cache.gateBuckets.set(flag, bucket)
    cache.allBuckets.add(bucket)
  }
  return bucket
}

function getBatchBucket(cache: InternalGateCache, flags: readonly AnyGateEvaluator[]): Bucket {
  const ref = validateBatch(flags)
  let bucket = cache.batchBuckets.get(ref)
  if (!bucket) {
    bucket = createBucket()
    cache.batchBuckets.set(ref, bucket)
    cache.allBuckets.add(bucket)
  }
  return bucket
}

function deleteAndBump(bucket: Bucket, key: string): void {
  bucket.entries.delete(key)
  bucket.stores.get(key)?.bump()
}

function readEntry(bucket: Bucket, key: string): Promise<unknown> | undefined {
  const entry = bucket.entries.get(key)
  if (!entry) return undefined
  const now = Date.now()
  if (
    (!entry.settled && entry.pendingExpiresAt !== undefined && now >= entry.pendingExpiresAt) ||
    (entry.settled && entry.expiresAt !== undefined && now >= entry.expiresAt)
  ) {
    bucket.entries.delete(key)
    return undefined
  }
  bucket.entries.delete(key)
  bucket.entries.set(key, entry)
  return entry.promise
}

function setEntry(
  cache: InternalGateCache,
  bucket: Bucket,
  key: string,
  promise: Promise<unknown>,
  ttlMs?: number
): Promise<unknown> {
  const entry: CacheEntry = {
    pendingExpiresAt:
      cache.options.pendingTtlMs === undefined
        ? undefined
        : Date.now() + cache.options.pendingTtlMs,
    promise,
    settled: false,
  }
  bucket.entries.set(key, entry)
  void promise.then(
    () => {
      entry.settled = true
      entry.pendingExpiresAt = undefined
      entry.expiresAt = Date.now() + (ttlMs ?? cache.options.ttlMs)
      setTimeout(() => {
        prune(cache, bucket)
      }, 0)
      return null
    },
    () => {
      entry.settled = true
      entry.pendingExpiresAt = undefined
      entry.expiresAt = Date.now() + (ttlMs ?? cache.options.ttlMs)
      setTimeout(() => {
        prune(cache, bucket)
      }, 0)
      return null
    }
  )
  prune(cache, bucket)
  return promise
}

function prune(cache: InternalGateCache, bucket: Bucket): void {
  const now = Date.now()
  for (const [key, entry] of bucket.entries) {
    if (
      (!entry.settled && entry.pendingExpiresAt !== undefined && now >= entry.pendingExpiresAt) ||
      (entry.settled && entry.expiresAt !== undefined && now >= entry.expiresAt)
    ) {
      bucket.entries.delete(key)
    }
  }
  while (bucket.entries.size > cache.options.maxEntries) {
    const settled = [...bucket.entries].find(([, entry]) => entry.settled)
    if (!settled) break
    bucket.entries.delete(settled[0])
  }
}

function evaluateFlag(flag: AnyGateEvaluator, identity?: Identity): Promise<unknown> {
  const details = flag.details as (options?: { identity?: Identity }) => Promise<unknown>
  return identity === undefined ? details() : details({ identity })
}

function validateBatch(flags: readonly AnyGateEvaluator[]) {
  const ref = flags[0] ? getEvaluatorFactoryRef(flags[0]) : undefined
  if (!ref || flags.some((flag) => getEvaluatorFactoryRef(flag) !== ref)) {
    throw new ForeignGateEvaluatorError()
  }
  return ref
}

function evaluateBatch(flags: readonly AnyGateEvaluator[], identity?: Identity): Promise<unknown> {
  const ref = validateBatch(flags)
  return ref.batch(flags, identity === undefined ? undefined : ({ identity } as never))
}

export function createGateCache(options: ReactGateCacheOptions = {}): ReactGateCache {
  assertCacheOptions(options)
  const buckets = new Set<Bucket>()
  const cache: InternalGateCache = {
    allBuckets: buckets,
    batchBuckets: new WeakMap(),
    clear() {
      for (const bucket of buckets) {
        bucket.entries.clear()
        for (const store of bucket.stores.values()) store.bump()
      }
    },
    customBucket: createBucket(),
    gateBuckets: new WeakMap(),
    invalidate(flag, identity) {
      const bucket = getBucket(cache, flag)
      buckets.add(bucket)
      deleteAndBump(bucket, identityKey(identity))
    },
    invalidateBatch(flags, identity) {
      if (flags.length === 0) return
      const bucket = getBatchBucket(cache, flags)
      deleteAndBump(bucket, batchKey(flags, identity))
    },
    invalidateKey(key) {
      deleteAndBump(cache.customBucket, serializeKey(key, "cacheKey"))
    },
    options: {
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      pendingTtlMs: options.pendingTtlMs,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    },
    async prefetch(flag, prefetchOptions = {}) {
      const bucket = getBucket(cache, flag)
      buckets.add(bucket)
      const key = identityKey(prefetchOptions.identity)
      let promise = readEntry(bucket, key)
      promise ??= createCachedEvaluation(
        cache,
        bucket,
        key,
        () => evaluateFlag(flag, prefetchOptions.identity),
        prefetchOptions.ttlMs
      )
      await promise
    },
    async prefetchBatch(flags, prefetchOptions = {}) {
      if (flags.length === 0) return
      const bucket = getBatchBucket(cache, flags)
      const key = batchKey(flags, prefetchOptions.identity)
      let promise = readEntry(bucket, key)
      promise ??= createCachedEvaluation(
        cache,
        bucket,
        key,
        () => evaluateBatch(flags, prefetchOptions.identity),
        prefetchOptions.ttlMs
      )
      await promise
    },
  }
  buckets.add(cache.customBucket)
  return cache
}

function createCachedEvaluation(
  cache: InternalGateCache,
  bucket: Bucket,
  key: string,
  evaluate: () => Promise<unknown>,
  ttlMs?: number
): Promise<unknown> {
  const cachedEvaluation = evictOnRejection(evaluate(), () => {
    setTimeout(() => {
      if (readEntry(bucket, key) === cachedEvaluation) bucket.entries.delete(key)
    }, 0)
  })
  return setEntry(cache, bucket, key, cachedEvaluation, ttlMs)
}

type GateContextValue = { cache: ReactGateCache; identity?: Identity }
const defaultCache = createGateCache()
const GateContext = createContext<GateContextValue | undefined>(undefined)
let didWarnAboutServerDefaultCache = false

export function GateProvider({
  cache: suppliedCache,
  identity,
  children,
}: {
  cache?: ReactGateCache
  identity?: Identity
  children: ReactNode
}): ReactNode {
  const [mountedCache, setMountedCache] = useState(createGateCache)
  void setMountedCache
  const value = useMemo(
    () => ({ cache: suppliedCache ?? mountedCache, identity }),
    [identity, mountedCache, suppliedCache]
  )
  return <GateContext value={value}>{children}</GateContext>
}

function useGateContext(): GateContextValue {
  const context = use(GateContext)
  if (!context) {
    if (
      !didWarnAboutServerDefaultCache &&
      isDevelopmentEnvironment() &&
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Server runtimes do not define window.
      globalThis.window === undefined
    ) {
      didWarnAboutServerDefaultCache = true
      // oxlint-disable-next-line no-console -- Development-only SSR safety warning.
      console.error(
        "useGate is using the shared default cache during server rendering. Mount GateProvider above the consumer Suspense boundary."
      )
    }
    return { cache: defaultCache }
  }
  return context
}

export function useGateCache(): ReactGateCache {
  return useGateContext().cache
}

function getVersionStore(
  bucket: Bucket,
  key: string,
  onFirstSubscribe?: (bump: () => void) => () => void
): VersionStore {
  const existing = bucket.stores.get(key)
  if (existing) return existing
  let version = 0
  const listeners = new Set<() => void>()
  let detach: (() => void) | undefined
  const store: VersionStore = {
    bump: () => {
      bucket.entries.delete(key)
      version += 1
      for (const listener of listeners) listener()
    },
    getSnapshot: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) detach = onFirstSubscribe?.(store.bump)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          detach?.()
          detach = undefined
        }
      }
    },
  }
  bucket.stores.set(key, store)
  return store
}

function changesSubscriber(flags: readonly AnyGateEvaluator[]) {
  const ref = flags[0] ? getEvaluatorFactoryRef(flags[0]) : undefined
  const keys = new Set(flags.map((flag) => getEvaluatorFlagKey(flag)))
  return (bump: () => void): (() => void) =>
    ref?.changes.subscribe((changedKeys) => {
      if (changedKeys === undefined || changedKeys.some((key) => keys.has(key))) bump()
    }) ?? (() => null)
}

export function useGate<TFlag extends AnyGateEvaluator>(
  flag: TFlag,
  options?: { identity?: GateIdentityOf<TFlag>; ttlMs?: number; details?: false }
): GateValueOf<TFlag>
export function useGate<TFlag extends AnyGateEvaluator>(
  flag: TFlag,
  options: { identity?: GateIdentityOf<TFlag>; ttlMs?: number; details: true }
): GateDetailsOf<TFlag>
export function useGate<TValue>(
  fn: () => Promise<TValue>,
  options: { key: ReactGateCacheKey; ttlMs?: number }
): TValue
export function useGate(
  input: AnyGateEvaluator | (() => Promise<unknown>),
  options: {
    identity?: Identity
    ttlMs?: number
    details?: boolean
    key?: ReactGateCacheKey
  } = {}
): unknown {
  const context = useGateContext()
  const cache = context.cache as InternalGateCache
  const evaluator = getEvaluatorFlagKey(input) !== undefined
  if (!evaluator && !("key" in options)) {
    throw new TypeError("useGate(fn, options) requires a key option")
  }
  const identity = options.identity ?? context.identity
  const bucket = evaluator ? getBucket(cache, input) : cache.customBucket
  const key = evaluator ? identityKey(identity) : serializeKey(options.key, "cacheKey")
  const store = getVersionStore(
    bucket,
    key,
    evaluator ? changesSubscriber([input as AnyGateEvaluator]) : undefined
  )
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  let promise = readEntry(bucket, key)
  promise ??= createCachedEvaluation(
    cache,
    bucket,
    key,
    evaluator
      ? () => evaluateFlag(input as AnyGateEvaluator, identity)
      : (input as () => Promise<unknown>),
    options.ttlMs
  )
  const result = use(promise)
  return evaluator && !options.details
    ? (result as EvaluationDetails<boolean | string>).value
    : result
}

export function useGateBatch<const TFlags extends readonly AnyGateEvaluator[]>(
  flags: TFlags,
  options: { identity?: GateBatchIdentityOf<TFlags>; ttlMs?: number } = {}
): GateBatchValuesOf<TFlags> {
  const context = useGateContext()
  const cache = context.cache as InternalGateCache
  const identity = options.identity ?? context.identity
  const bucket = flags.length === 0 ? undefined : getBatchBucket(cache, flags)
  const key = batchKey(flags, identity)
  const store = bucket
    ? getVersionStore(bucket, key, changesSubscriber(flags))
    : EMPTY_VERSION_STORE
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  if (!bucket) return [] as unknown as GateBatchValuesOf<TFlags>
  let promise = readEntry(bucket, key)
  promise ??= createCachedEvaluation(
    cache,
    bucket,
    key,
    () => evaluateBatch(flags, identity),
    options.ttlMs
  )
  return use(promise) as GateBatchValuesOf<TFlags>
}

type FeatureGateBase<TFlag extends AnyGateEvaluator> = {
  children: ReactNode
  fallback?: ReactNode
  gate: TFlag
  identity?: GateIdentityOf<TFlag>
  loading?: ReactNode
}
type FeatureGateProps<TFlag extends AnyGateEvaluator> =
  GateValueOf<TFlag> extends boolean
    ? FeatureGateBase<TFlag> & { match?: boolean }
    : FeatureGateBase<TFlag> & { match: GateValueOf<TFlag> }

type GateSlotRuntimeProps = {
  children: ReactNode
  fallback?: ReactNode
  gate: AnyGateEvaluator
  identity?: Identity
  match?: boolean | string
}

function GateSlot({ children, fallback, gate, identity, match }: GateSlotRuntimeProps): ReactNode {
  const value = useGate(gate, { identity } as never)
  if (typeof value === "string" && match === undefined) {
    if (isDevelopmentEnvironment()) {
      // oxlint-disable-next-line no-console -- Development-only JavaScript misuse warning.
      console.error("FeatureGate requires a match prop when its gate returns a string variant.")
    }
    return fallback
  }
  return value === (match ?? true) ? children : fallback
}

export function FeatureGate<TFlag extends AnyGateEvaluator>(
  props: FeatureGateProps<TFlag>
): ReactNode {
  const { loading, ...slotProps } = props as unknown as GateSlotRuntimeProps & {
    loading?: ReactNode
  }
  const slot = <GateSlot {...slotProps} />
  return loading === undefined ? slot : <Suspense fallback={loading}>{slot}</Suspense>
}
