import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import * as React from "react"
import { act, Component, createRef, Profiler, type ReactNode, Suspense } from "react"
import { renderToString } from "react-dom/server"
import type { GateCallOptions, GateChanges, GateEvaluator, Identity } from "../../lib/types"
import { decision } from "../../decision"
import { buildGate } from "../../factory"
import {
  createReactGate,
  createReactGateCache,
  FeatureGate,
  GateCacheProvider,
  type ReactGateCacheKey,
  type ReactGate,
} from "../react"

afterEach(() => {
  cleanup()
})

const INVALID_VARIANT_GATE: () => boolean = () => "dark" as never

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: Error) => void
  resolve: (value: T) => void
} {
  let rejectPromise!: (error: Error) => void
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

function GateValue<TIdentity extends Identity>({
  gate,
  identity,
}: {
  gate: ReactGate<TIdentity, boolean | string>
  identity?: TIdentity
}): ReactNode {
  return <div data-testid="value">{String(gate(identity))}</div>
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | undefined }> {
  override state: { error: Error | undefined } = { error: undefined }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  reset(): void {
    this.setState({ error: undefined })
  }

  override render(): ReactNode {
    return this.state.error ? (
      <div data-testid="error">{this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

const customGateTypeTest = (accountId: string, traceId: string): Promise<boolean> =>
  Promise.resolve(accountId === traceId)

class UnsupportedIdentityValue {
  readonly marker = "unsupported"
}

const unsupportedIdentityValues: ReadonlyArray<[string, unknown]> = [
  ["Date", new Date(0)],
  ["Map", new Map([["key", "value"]])],
  ["class instance", new UnsupportedIdentityValue()],
  ["symbol", Symbol("value")],
  ["function", () => true],
  ["bigint", 1n],
]

const sharedCacheKeyValue = { x: 1 }
const cacheKeyPairs: ReadonlyArray<
  [
    caseName: string,
    first: ReactGateCacheKey,
    second: ReactGateCacheKey,
    expectedEvaluations: number,
  ]
> = [
  ["zero and negative zero", 0, -0, 2],
  ["number zero and string zero", 0, "0", 2],
  ["null and undefined", null, undefined, 2],
  ["null and its string spelling", null, "null", 2],
  ["undefined and the string null", undefined, "null", 2],
  ["an undefined record value and an empty record", { a: undefined }, {}, 2],
  ["an array and a scalar", ["a"], "a", 2],
  [
    "reordered nested records",
    { nested: { a: 1, b: 2 } },
    {
      nested: Object.fromEntries([
        ["b", 2],
        ["a", 1],
      ]),
    },
    1,
  ],
  ["different nested values", { nested: { value: 1 } }, { nested: { value: 2 } }, 2],
  [
    "shared and duplicated sibling objects",
    { a: sharedCacheKeyValue, b: sharedCacheKeyValue },
    { a: { x: 1 }, b: { x: 1 } },
    1,
  ],
]

function assertCreateReactGateTypes(evaluator: GateEvaluator<Identity, boolean>): void {
  const changes = null as never as GateChanges
  const gatedReactGate = createReactGate(evaluator)
  createReactGate(evaluator, { changes })

  gatedReactGate({ distinctId: "user-1" })
  // @ts-expect-error -- Custom async functions require an explicit semantic cache projection.
  createReactGate(customGateTypeTest)
  const customReactGate = createReactGate(customGateTypeTest, {
    cacheKey: (accountId) => accountId,
  })
  // @ts-expect-error -- Cache projections only accept the supported recursive key domain.
  createReactGate(customGateTypeTest, { cacheKey: () => 1n })
  customReactGate("account-1", "trace-1")
  customReactGate.invalidateKey("account-1")
  customReactGate.invalidate("account-1", "trace-2")
  type GatedReactGateHasInvalidateKey = "invalidateKey" extends keyof typeof gatedReactGate
    ? true
    : false
  const gatedReactGateHasInvalidateKey: GatedReactGateHasInvalidateKey = false
  void gatedReactGateHasInvalidateKey
}

void assertCreateReactGateTypes

describe("createReactGate", () => {
  test("uses the nearest provider cache when no option cache is set", async () => {
    const cache = createReactGateCache<boolean>()
    const cacheSet = spyOn(cache, "set")
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)

    await act(async () => {
      render(
        <GateCacheProvider cache={cache}>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        </GateCacheProvider>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })

    expect(cacheSet).toHaveBeenCalledTimes(1)
  })

  test("prefers an option cache to the nearest provider cache", async () => {
    const providerCache = createReactGateCache<boolean>()
    const optionCache = createReactGateCache<boolean>()
    const providerSet = spyOn(providerCache, "set")
    const optionSet = spyOn(optionCache, "set")
    const useBetaAccess = createReactGate(() => Promise.resolve(true), { cache: optionCache })

    await act(async () => {
      render(
        <GateCacheProvider cache={providerCache}>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        </GateCacheProvider>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })

    expect(optionSet).toHaveBeenCalledTimes(1)
    expect(providerSet).not.toHaveBeenCalled()
  })

  test("isolates sibling provider caches", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const identity = { distinctId: "same-user" }

    await act(async () => {
      render(
        <>
          <GateCacheProvider cache={createReactGateCache()}>
            <Suspense fallback="Loading">
              <GateValue gate={useBetaAccess} identity={identity} />
            </Suspense>
          </GateCacheProvider>
          <GateCacheProvider cache={createReactGateCache()}>
            <Suspense fallback="Loading">
              <GateValue gate={useBetaAccess} identity={identity} />
            </Suspense>
          </GateCacheProvider>
        </>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })

    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("uses each provider cache across sequential renders of one hook", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const identity = { distinctId: "same-user" }

    let first!: ReturnType<typeof render>
    await act(async () => {
      first = render(
        <GateCacheProvider cache={createReactGateCache()}>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} identity={identity} />
          </Suspense>
        </GateCacheProvider>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })
    first.unmount()

    await act(async () => {
      render(
        <GateCacheProvider cache={createReactGateCache()}>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} identity={identity} />
          </Suspense>
        </GateCacheProvider>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })

    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("namespaces two hooks that share a provider cache", async () => {
    const cache = createReactGateCache<boolean>()
    const enabledEvaluator = mock(() => Promise.resolve(true))
    const disabledEvaluator = mock(() => Promise.resolve(false))
    const useEnabled = createReactGate(enabledEvaluator)
    const useDisabled = createReactGate(disabledEvaluator)

    await act(async () => {
      render(
        <GateCacheProvider cache={cache}>
          <Suspense fallback="Loading">
            <GateValue gate={useEnabled} identity={{ distinctId: "same-user" }} />
            <GateValue gate={useDisabled} identity={{ distinctId: "same-user" }} />
          </Suspense>
        </GateCacheProvider>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getAllByTestId("value").map((node) => node.textContent)).toEqual([
        "true",
        "false",
      ])
    })

    expect(enabledEvaluator).toHaveBeenCalledTimes(1)
    expect(disabledEvaluator).toHaveBeenCalledTimes(1)
  })

  test("does not warn about a module default cache in production server rendering", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => false)
    const previousNodeEnv = process.env.NODE_ENV
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
    process.env.NODE_ENV = "production"
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
      writable: true,
    })

    try {
      const useBetaAccess = createReactGate(() => Promise.resolve(true))
      renderToString(
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} />
        </Suspense>
      )
      expect(consoleError).not.toHaveBeenCalledWith(
        "createReactGate is using its module-scope default cache during server rendering. Wrap the app in GateCacheProvider with a per-request cache."
      )
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor)
      }
      consoleError.mockRestore()
    }
  })

  test("warns once about a module default cache in development server rendering", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => false)
    const previousNodeEnv = process.env.NODE_ENV
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
    process.env.NODE_ENV = "development"
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
      writable: true,
    })

    try {
      const useBetaAccess = createReactGate(() => Promise.resolve(true))
      const view = (
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} />
        </Suspense>
      )
      renderToString(view)
      renderToString(view)
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalledWith(
        "createReactGate is using its module-scope default cache during server rendering. Wrap the app in GateCacheProvider with a per-request cache."
      )
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor)
      }
      consoleError.mockRestore()
    }
  })

  test("caches one async evaluation across suspension and rerenders", async () => {
    const evaluation = deferred<boolean>()
    const gateFn = mock(() => evaluation.promise)
    const useBetaAccess = createReactGate(gateFn)

    const view = (
      <Suspense fallback={<div data-testid="loading">Loading</div>}>
        <GateValue gate={useBetaAccess} />
      </Suspense>
    )
    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(view)
      await Promise.resolve()
    })

    expect(screen.getByTestId("loading").textContent).toBe("Loading")
    expect(gateFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      evaluation.resolve(true)
      await evaluation.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })

    await act(async () => {
      rendered.rerender(view)
      await Promise.resolve()
    })
    expect(gateFn).toHaveBeenCalledTimes(1)
  })

  test("omits evaluator options when no identity is provided", async () => {
    const gateFn = mock((_options?: GateCallOptions<Identity>) => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} />
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })

    expect(gateFn.mock.calls[0]).toEqual([])
  })

  test("uses stable identity keys", async () => {
    type TestIdentity = Identity & { plan: string }
    const gateFn = mock((options?: GateCallOptions<TestIdentity>) =>
      Promise.resolve(options?.identity?.plan === "pro")
    )
    const useBetaAccess = createReactGate(gateFn)
    const firstIdentity = { distinctId: "user-1", plan: "pro" }
    const sameIdentity = Object.fromEntries([
      ["plan", "pro"],
      ["distinctId", "user-1"],
    ]) as TestIdentity

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} identity={firstIdentity} />
          <GateValue gate={useBetaAccess} identity={sameIdentity} />
        </Suspense>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })
    expect(gateFn).toHaveBeenCalledTimes(1)
  })

  test("reacts only to changes for the rendered evaluator and detaches on unmount", async () => {
    let enabled = false
    let renderCount = 0
    const listeners = new Set<(change: { keys?: readonly string[] }) => void>()
    const detachProvider = mock(() => null)
    const subscribe = mock((listener: (change: { keys?: readonly string[] }) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        detachProvider()
        return null
      }
    })
    const notify = (change: { keys?: readonly string[] }) => {
      for (const listener of listeners) {
        listener(change)
      }
    }
    const decide = mock(async () => {
      await Promise.resolve()
      return decision.boolean(enabled)
    })
    const gate = buildGate({
      decide,
      identify: () => ({ distinctId: "user-1" }),
      subscribe,
    })
    const useBetaAccess = createReactGate(gate({ defaultValue: false, key: "beta-access" }), {
      changes: gate.changes,
    })

    function ReactiveGateValue() {
      return <div data-testid="reactive-value">{String(useBetaAccess())}</div>
    }

    const onRender = () => {
      renderCount += 1
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(
        <Profiler id="reactive-gate" onRender={onRender}>
          <Suspense fallback="Loading">
            <ReactiveGateValue />
          </Suspense>
        </Profiler>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("reactive-value").textContent).toBe("false")
    })
    expect(decide).toHaveBeenCalledTimes(1)
    const settledRenderCount = renderCount

    await act(async () => {
      notify({ keys: ["unused-flag"] })
      await Promise.resolve()
    })
    expect(renderCount).toBe(settledRenderCount)
    expect(decide).toHaveBeenCalledTimes(1)

    enabled = true
    await act(async () => {
      notify({ keys: ["beta-access"] })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("reactive-value").textContent).toBe("true")
    })
    expect(decide).toHaveBeenCalledTimes(2)

    rendered.unmount()
    expect(detachProvider.mock.calls.length).toBeGreaterThanOrEqual(1)

    // A change after unmount refetches nothing. The factory's invalidation subscription is
    // factory-scoped, so it outlives the component; only the changes-hub listener detaches.
    notify({ keys: ["beta-access"] })
    await Bun.sleep(0)
    expect(decide).toHaveBeenCalledTimes(2)
    expect(listeners.size).toBe(1)
  })

  test("prunes a reactive version store after its last subscriber detaches", async () => {
    const subscriptions = new Set<(listener: () => void) => () => void>()
    const originalUseSyncExternalStore = React.useSyncExternalStore
    const useSyncExternalStore = spyOn(React, "useSyncExternalStore").mockImplementation(
      (subscribe, getSnapshot, getServerSnapshot) => {
        subscriptions.add(subscribe)
        return originalUseSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
      }
    )
    const changes: GateChanges = {
      subscribe: () => () => null,
    }
    const useBetaAccess = createReactGate(() => Promise.resolve(true), { changes })

    try {
      let first!: ReturnType<typeof render>
      await act(async () => {
        first = render(
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        )
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(screen.getByTestId("value").textContent).toBe("true")
      })
      first.unmount()
      const firstSubscribe = [...subscriptions][0]
      if (!firstSubscribe) {
        throw new Error("Expected React to register the first version store")
      }
      const detachResubscribedStore = firstSubscribe(() => null)
      detachResubscribedStore()

      let second!: ReturnType<typeof render>
      await act(async () => {
        second = render(
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        )
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(screen.getByTestId("value").textContent).toBe("true")
      })
      second.unmount()

      expect(subscriptions).toHaveLength(2)
    } finally {
      useSyncExternalStore.mockRestore()
    }
  })

  test("rejects a non-plain identity value with its path", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const consoleError = spyOn(console, "error").mockImplementation(() => false)

    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback="Loading">
            <GateValue
              gate={useBetaAccess}
              identity={{ createdAt: new Date(0), distinctId: "user-1" }}
            />
          </Suspense>
        </ErrorBoundary>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain("identity.createdAt")
      expect(screen.getByTestId("error").textContent).toContain("Change identify()")
    })
    expect(gateFn).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test.each(
    unsupportedIdentityValues.flatMap(([kind, value]) => [
      [`${kind} at a direct path`, { distinctId: "user-1", unsafe: value }, "identity.unsafe"],
      [
        `${kind} at a nested path`,
        { distinctId: "user-1", nested: { unsafe: value } },
        "identity.nested.unsafe",
      ],
    ])
  )("rejects %s", async (_caseName, invalidIdentity, expectedPath) => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const consoleError = spyOn(console, "error").mockImplementation(() => false)

    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} identity={invalidIdentity as Identity} />
          </Suspense>
        </ErrorBoundary>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain(expectedPath)
    })
    expect(gateFn).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test("invalidates a custom gate by projected key or argument tuple", async () => {
    const gateFn = mock((_accountId: string, _traceId: string) => Promise.resolve(true))
    const useAccountGate = createReactGate(gateFn, {
      cacheKey: (accountId) => accountId,
    })

    function AccountGateValue({ revision, traceId }: { revision: number; traceId: string }) {
      return (
        <div data-revision={revision} data-testid="custom-value">
          {String(useAccountGate("account-1", traceId))}
        </div>
      )
    }

    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(
        <Suspense fallback="Loading">
          <AccountGateValue revision={0} traceId="trace-1" />
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("custom-value").textContent).toBe("true")
    })

    await act(async () => {
      rendered.rerender(
        <Suspense fallback="Loading">
          <AccountGateValue revision={1} traceId="trace-2" />
        </Suspense>
      )
      await Promise.resolve()
    })
    expect(gateFn).toHaveBeenCalledTimes(1)

    useAccountGate.invalidateKey("account-1")
    await act(async () => {
      rendered.rerender(
        <Suspense fallback="Loading">
          <AccountGateValue revision={2} traceId="trace-2" />
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(2)
    })
    expect(gateFn).toHaveBeenLastCalledWith("account-1", "trace-2")

    useAccountGate.invalidate("account-1", "ignored-trace")
    await act(async () => {
      rendered.rerender(
        <Suspense fallback="Loading">
          <AccountGateValue revision={3} traceId="trace-3" />
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(3)
    })
    expect(gateFn).toHaveBeenLastCalledWith("account-1", "trace-3")
  })

  test("keeps undefined record values distinct in custom cache keys", async () => {
    const gateFn = mock((_key: "empty" | "undefined") => Promise.resolve(true))
    const useCustomGate = createReactGate(gateFn, {
      cacheKey: (key) => (key === "empty" ? {} : { value: undefined }),
    })

    function CustomGateValue({ cacheKey }: { cacheKey: "empty" | "undefined" }) {
      return <div data-testid="custom-key-value">{String(useCustomGate(cacheKey))}</div>
    }

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <CustomGateValue cacheKey="empty" />
          <CustomGateValue cacheKey="undefined" />
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getAllByTestId("custom-key-value")).toHaveLength(2)
    })

    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("rejects circular custom cache keys with their path", async () => {
    const recursiveKey: { self?: ReactGateCacheKey } = {}
    recursiveKey.self = recursiveKey
    const gateFn = mock(() => Promise.resolve(true))
    const useCustomGate = createReactGate(gateFn, { cacheKey: () => recursiveKey })
    const consoleError = spyOn(console, "error").mockImplementation(() => false)

    function RecursiveKeyValue() {
      return <div data-testid="recursive-key-value">{String(useCustomGate())}</div>
    }

    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback="Loading">
            <RecursiveKeyValue />
          </Suspense>
        </ErrorBoundary>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain("cacheKey.self")
    })

    expect(gateFn).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test.each(cacheKeyPairs)(
    "distinguishes cache keys iff structurally required: %s",
    async (_caseName, firstKey, secondKey, expectedEvaluations) => {
      const gateFn = mock((_key: ReactGateCacheKey) => Promise.resolve(true))
      const useCustomGate = createReactGate(gateFn, { cacheKey: (key) => key })

      function CacheKeyValue({ cacheKey }: { cacheKey: ReactGateCacheKey }) {
        return <div data-testid="cache-key-value">{String(useCustomGate(cacheKey))}</div>
      }

      await act(async () => {
        render(
          <Suspense fallback="Loading">
            <CacheKeyValue cacheKey={firstKey} />
            <CacheKeyValue cacheKey={secondKey} />
          </Suspense>
        )
        await Promise.resolve()
      })
      await waitFor(() => {
        expect(screen.getAllByTestId("cache-key-value")).toHaveLength(2)
      })

      expect(gateFn).toHaveBeenCalledTimes(expectedEvaluations)
    }
  )

  test("evaluates different identities independently", async () => {
    const gateFn = mock((options?: GateCallOptions<Identity>) =>
      Promise.resolve(options?.identity?.distinctId === "enabled")
    )
    const useBetaAccess = createReactGate(gateFn)

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} identity={{ distinctId: "enabled" }} />
          <GateValue gate={useBetaAccess} identity={{ distinctId: "disabled" }} />
        </Suspense>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })
    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("keeps concurrent pending identities stable beyond the settled-entry bound", async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const gateFn = mock((options?: GateCallOptions<Identity>) =>
      options?.identity?.distinctId === "first" ? first.promise : second.promise
    )
    const useBetaAccess = createReactGate(gateFn, { maxEntries: 1 })

    await act(async () => {
      render(
        <>
          <Suspense fallback={<div data-testid="first-loading">Loading first</div>}>
            <GateValue gate={useBetaAccess} identity={{ distinctId: "first" }} />
          </Suspense>
          <Suspense fallback={<div data-testid="second-loading">Loading second</div>}>
            <GateValue gate={useBetaAccess} identity={{ distinctId: "second" }} />
          </Suspense>
        </>
      )
      await Promise.resolve()
    })

    expect(screen.getByTestId("first-loading")).not.toBeNull()
    expect(screen.getByTestId("second-loading")).not.toBeNull()
    expect(gateFn).toHaveBeenCalledTimes(2)

    await act(async () => {
      first.resolve(true)
      second.resolve(false)
      await Promise.all([first.promise, second.promise])
    })
    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })
    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("invalidate and clear take effect on the next render", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const identity = { distinctId: "user-1" }
    const view = (revision: number): ReactNode => (
      <Suspense fallback="Loading">
        <div data-revision={revision}>
          <GateValue gate={useBetaAccess} identity={identity} />
        </div>
      </Suspense>
    )
    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(view(0))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("value")).not.toBeNull()
    })
    expect(gateFn).toHaveBeenCalledTimes(1)

    useBetaAccess.invalidate(identity)
    expect(gateFn).toHaveBeenCalledTimes(1)
    await act(async () => {
      rendered.rerender(view(1))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(2)
    })

    useBetaAccess.clear()
    expect(gateFn).toHaveBeenCalledTimes(2)
    await act(async () => {
      rendered.rerender(view(2))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(3)
    })
  })

  test("invalidate without an identity only evicts the default identity", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn)
    const identity = { distinctId: "user-1" }
    const view = (revision: number): ReactNode => (
      <Suspense fallback="Loading">
        <div data-revision={revision}>
          <GateValue gate={useBetaAccess} />
          <GateValue gate={useBetaAccess} identity={identity} />
        </div>
      </Suspense>
    )
    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(view(0))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })
    expect(gateFn).toHaveBeenCalledTimes(2)

    useBetaAccess.invalidate()
    await act(async () => {
      rendered.rerender(view(1))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(3)
    })
  })

  test("reevaluates after TTL expiry and LRU eviction on later renders", async () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const gateFn = mock(() => Promise.resolve(true))
    const useBetaAccess = createReactGate(gateFn, { maxEntries: 1, ttlMs: 100 })
    const firstIdentity = { distinctId: "first" }
    const secondIdentity = { distinctId: "second" }
    const view = (identity: Identity, revision: number): ReactNode => (
      <Suspense fallback="Loading">
        <div data-revision={revision}>
          <GateValue gate={useBetaAccess} identity={identity} />
        </div>
      </Suspense>
    )
    let rendered!: ReturnType<typeof render>
    await act(async () => {
      rendered = render(view(firstIdentity, 0))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(1)
    })

    now = 101
    await act(async () => {
      rendered.rerender(view(firstIdentity, 1))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      rendered.rerender(view(secondIdentity, 2))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(3)
    })
    await act(async () => {
      rendered.rerender(view(firstIdentity, 3))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(gateFn).toHaveBeenCalledTimes(4)
    })
    dateNow.mockRestore()
  })

  test("evicts rejected evaluations so a mounted tree can reset and retry", async () => {
    let invocation = 0
    const gateFn = mock(() => {
      invocation += 1
      return invocation === 1
        ? Promise.reject(new Error("provider unavailable"))
        : Promise.resolve(true)
    })
    const useBetaAccess = createReactGate(gateFn)
    const consoleError = spyOn(console, "error").mockImplementation(() => false)

    const boundary = createRef<ErrorBoundary>()
    const view = (
      <ErrorBoundary ref={boundary}>
        <Suspense fallback="Loading">
          <GateValue gate={useBetaAccess} />
        </Suspense>
      </ErrorBoundary>
    )
    await act(async () => {
      render(view)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("provider unavailable")
    })

    await act(async () => {
      await Bun.sleep(0)
      boundary.current?.reset()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("value").textContent).toBe("true")
    })
    expect(gateFn).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  test("isolates injected request-scoped caches", async () => {
    const gateFn = mock(() => Promise.resolve(true))
    const firstRequestGate = createReactGate(gateFn, { cache: createReactGateCache() })
    const secondRequestGate = createReactGate(gateFn, { cache: createReactGateCache() })

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <GateValue gate={firstRequestGate} identity={{ distinctId: "same-user" }} />
          <GateValue gate={secondRequestGate} identity={{ distinctId: "same-user" }} />
        </Suspense>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("value")).toHaveLength(2)
    })
    expect(gateFn).toHaveBeenCalledTimes(2)
  })

  test("namespaces multiple gates that share one request-scoped cache", async () => {
    const cache = createReactGateCache<boolean>()
    const enabledEvaluator = mock(() => Promise.resolve(true))
    const disabledEvaluator = mock(() => Promise.resolve(false))
    const useEnabled = createReactGate(enabledEvaluator, { cache })
    const useDisabled = createReactGate(disabledEvaluator, { cache })

    await act(async () => {
      render(
        <Suspense fallback="Loading">
          <GateValue gate={useEnabled} identity={{ distinctId: "same-user" }} />
          <GateValue gate={useDisabled} identity={{ distinctId: "same-user" }} />
        </Suspense>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByTestId("value").map((node) => node.textContent)).toEqual([
        "true",
        "false",
      ])
    })
    expect(enabledEvaluator).toHaveBeenCalledTimes(1)
    expect(disabledEvaluator).toHaveBeenCalledTimes(1)
  })
})

describe("FeatureGate", () => {
  test("regression: FeatureGate loading renders during suspension (H2)", async () => {
    const evaluation = deferred<boolean>()
    const gateFn = mock(() => evaluation.promise)
    const useBetaAccess = createReactGate(gateFn)

    await act(async () => {
      render(
        <FeatureGate
          fallback={<div data-testid="fallback">Unavailable</div>}
          gate={useBetaAccess}
          loading={<div data-testid="loading">Loading</div>}
        >
          <div data-testid="feature">Beta</div>
        </FeatureGate>
      )
      await Promise.resolve()
    })

    expect(screen.getByTestId("loading").textContent).toBe("Loading")
    await act(async () => {
      evaluation.resolve(true)
      await evaluation.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Beta")
    })
    expect(gateFn).toHaveBeenCalledTimes(1)
  })

  test("uses an ancestor Suspense fallback when loading is omitted", async () => {
    const evaluation = deferred<boolean>()
    const useBetaAccess = createReactGate(() => evaluation.promise)

    await act(async () => {
      render(
        <Suspense fallback={<div data-testid="ancestor-loading">Loading application</div>}>
          <FeatureGate gate={useBetaAccess}>
            <div data-testid="feature">Beta</div>
          </FeatureGate>
        </Suspense>
      )
      await Promise.resolve()
    })

    expect(screen.getByTestId("ancestor-loading").textContent).toBe("Loading application")
    await act(async () => {
      evaluation.resolve(true)
      await evaluation.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Beta")
    })
  })

  test("renders a variant from a real buildGate evaluator", async () => {
    const decide = mock(() => decision.variant("dark", { experiment: "theme" }))
    const gate = buildGate({
      decide,
      identify: () => ({ distinctId: "user-1" }),
    })
    const useTheme = createReactGate(
      gate({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })
    )

    await act(async () => {
      render(
        <FeatureGate<{ distinctId: string }, typeof useTheme>
          fallback="Light"
          gate={useTheme}
          loading="Loading"
          match="dark"
        >
          <div data-testid="feature">Dark</div>
        </FeatureGate>
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Dark")
    })
    expect(decide).toHaveBeenCalledWith("theme", { distinctId: "user-1" }, expect.any(Object))
  })

  test("renders fallback when a boolean gate does not match", () => {
    render(
      <FeatureGate fallback={<div data-testid="fallback">Unavailable</div>} gate={() => false}>
        <div data-testid="feature">Beta</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("fallback").textContent).toBe("Unavailable")
    expect(screen.queryByTestId("feature")).toBeNull()
  })

  test("supports an explicit false match", () => {
    render(
      <FeatureGate gate={() => false} match={false}>
        <div data-testid="feature">Disabled experience</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("feature").textContent).toBe("Disabled experience")
  })

  test("matches string variants exactly", () => {
    render(
      <FeatureGate fallback="Light" gate={() => "dark"} match="dark">
        <div data-testid="feature">Dark</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("feature").textContent).toBe("Dark")
  })

  test("passes the identity to the gate", () => {
    type TestIdentity = Identity & { plan: "free" | "pro" }
    const gate = mock((identity?: TestIdentity) => identity?.plan === "pro")
    const identity: TestIdentity = { distinctId: "user-1", plan: "pro" }

    render(
      <FeatureGate gate={gate} identity={identity}>
        <div data-testid="feature">Pro</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("feature").textContent).toBe("Pro")
    expect(gate).toHaveBeenCalledWith(identity)
  })

  test("warns and renders fallback when a string gate has no match", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => false)
    render(
      <FeatureGate
        fallback={<div data-testid="fallback">No match</div>}
        gate={INVALID_VARIANT_GATE}
      >
        <div data-testid="feature">Dark</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("fallback").textContent).toBe("No match")
    expect(screen.queryByTestId("feature")).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(
      "FeatureGate requires a match prop when its gate returns a string variant."
    )
    consoleError.mockRestore()
  })
})
