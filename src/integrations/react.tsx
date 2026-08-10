import { createContext, type ReactNode, Suspense, use, useSyncExternalStore } from "react"
import type { GateCallOptions, GateChanges, Identity } from "../lib/types"
import {
  createCacheNamespace,
  createGateCache,
  type CreateGateOptions,
  deriveKey,
  evictOnRejection,
  type GateCache,
  type GateCacheKey,
  type GateCacheOptions,
  serializeKey,
} from "../lib/cache"
import { getEvaluatorFlagKey } from "../lib/evaluation/registry"
import { isDevelopmentEnvironment } from "../lib/utils"

let didWarnAboutServerDefaultCache = false

export type ReactGateCacheOptions = GateCacheOptions

export type CreateReactGateOptions<TValue extends boolean | string> = CreateGateOptions<TValue>

export type ReactGateCacheKey = GateCacheKey

export type CustomCreateReactGateOptions<
  TArgs extends unknown[],
  TValue extends boolean | string,
> = CreateReactGateOptions<TValue> & {
  /**
   * Projects the function arguments to the semantic value used for cache lookup and invalidation.
   */
  cacheKey: (...args: TArgs) => ReactGateCacheKey
}

export type ReactGateCache<TValue extends boolean | string = boolean | string> = GateCache<TValue>

export { createGateCache as createReactGateCache } from "../lib/cache"

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

/**
 * Portable in concept — nothing here imports React — but the integer-snapshot/subscribe shape is
 * molded to the useSyncExternalStore contract. Keep this and its registry in the integration until
 * a second integration (Solid, Svelte) proves the shape, then hoist the shared parts into lib.
 */
type ReactGateVersionStore = {
  bump: () => void
  getSnapshot: () => number
  subscribe: (listener: () => void) => () => void
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
  const invokeGate = gateFn as (...args: unknown[]) => Promise<TValue>

  const defaultCache = runtimeOptions.cache ?? createGateCache<TValue>(runtimeOptions)
  const evaluatorFlagKey = getEvaluatorFlagKey(gateFn)
  const cacheNamespace = createCacheNamespace()
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
        if (!stores.has(key)) {
          stores.set(key, store)
        }
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
            if (stores.get(key) === store) {
              stores.delete(key)
            }
          }
        }
      },
    }
    stores.set(key, store)
    return store
  }
  const keyOf = (args: unknown[]): string =>
    deriveKey(args, { cacheKey: runtimeOptions.cacheKey, namespace: cacheNamespace })

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
        ? invokeGate(...args)
        : args[0] === undefined
          ? invokeGate()
          : invokeGate({ identity: args[0] })
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
      defaultCache.delete(cacheNamespace + serializeKey(key, "cacheKey"))
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
