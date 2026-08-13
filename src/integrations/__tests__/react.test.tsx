import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, render, screen } from "@testing-library/react"
import { Component, type ReactNode, Suspense } from "react"
import { buildGate, decision } from "../../index"
import {
  createGateCache,
  FeatureGate,
  GateProvider,
  useGate,
  useGateBatch,
  useGateCache,
} from "../react"

afterEach(cleanup)

function makeFactory() {
  const decide = mock((key: string) =>
    key === "theme" ? decision.variant("dark", { experiment: "A" }) : decision.boolean(true)
  )
  const decideMany = mock((keys: readonly string[]) =>
    Object.fromEntries(
      keys.map((key) => [key, key === "theme" ? decision.variant("dark") : decision.boolean(true)])
    )
  )
  const factory = buildGate({
    decide,
    decideMany,
    identify: () => ({ distinctId: "default" }),
  })
  return { decide, decideMany, factory }
}

async function renderAsync(node: ReactNode): Promise<void> {
  await act(() => {
    render(node)
    return Promise.resolve()
  })
}

describe("React integration", () => {
  it("uses evaluators directly and shares value and details evaluations", async () => {
    const { decide, factory } = makeFactory()
    const flag = factory({ defaultValue: false, key: "beta" })
    function Value() {
      return <span>{String(useGate(flag))}</span>
    }
    function Details() {
      return <span>{useGate(flag, { details: true }).source}</span>
    }
    await renderAsync(
      <GateProvider>
        <Suspense fallback="loading">
          <Value />
          <Details />
        </Suspense>
      </GateProvider>
    )
    expect(await screen.findByText("true")).toBeTruthy()
    expect(await screen.findByText("provider")).toBeTruthy()
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it("uses provider identity and lets hook identity override it", async () => {
    const seen: unknown[] = []
    const factory = buildGate({
      decide: (_key, identity) => {
        seen.push(identity.distinctId)
        return decision.boolean(true)
      },
      identify: () => ({ distinctId: "core" }),
    })
    const flag = factory({ defaultValue: false, key: "beta" })
    function ProviderConsumer() {
      return <span>{String(useGate(flag))}</span>
    }
    function HookConsumer() {
      return <span>{String(useGate(flag, { identity: { distinctId: "hook" } }))}</span>
    }
    await renderAsync(
      <GateProvider identity={{ distinctId: "provider" }}>
        <Suspense fallback="loading">
          <ProviderConsumer />
          <HookConsumer />
        </Suspense>
      </GateProvider>
    )
    await screen.findAllByText("true")
    expect(seen.toSorted((left, right) => String(left).localeCompare(String(right)))).toEqual([
      "hook",
      "provider",
    ])
  })

  it("supports custom functions and live invalidation", async () => {
    const call = mock(() => Promise.resolve(7))
    const cache = createGateCache()
    function Consumer() {
      return <span>{useGate(call, { key: "answer" })}</span>
    }
    await renderAsync(
      <GateProvider cache={cache}>
        <Suspense fallback="loading">
          <Consumer />
        </Suspense>
      </GateProvider>
    )
    expect(await screen.findByText("7")).toBeTruthy()
    await act(() => {
      cache.invalidateKey("answer")
      return Promise.resolve()
    })
    expect(await screen.findByText("7")).toBeTruthy()
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("batches gates in one provider call and preserves tuple order", async () => {
    const { decideMany, factory } = makeFactory()
    const beta = factory({ defaultValue: false, key: "beta" })
    const theme = factory({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })
    function Consumer() {
      const [betaValue, themeValue] = useGateBatch([beta, theme])
      return <span>{`${betaValue}:${themeValue}`}</span>
    }
    await renderAsync(
      <Suspense fallback="loading">
        <Consumer />
      </Suspense>
    )
    expect(await screen.findByText("true:dark")).toBeTruthy()
    expect(decideMany).toHaveBeenCalledTimes(1)
  })

  it("returns an empty tuple without suspension", () => {
    render(<EmptyBatchConsumer />)
    expect(screen.getByText("0")).toBeTruthy()
  })

  it("rejects batches from different factories", () => {
    const first = makeFactory().factory({ defaultValue: false, key: "first" })
    const second = makeFactory().factory({ defaultValue: false, key: "second" })
    function Consumer() {
      useGateBatch([first, second])
      return null
    }
    expect(() => render(<Consumer />)).toThrow("Batch flags must be created by this gate factory")
  })

  it("prefetches one gate and batches without a second call", async () => {
    const { decide, decideMany, factory } = makeFactory()
    const beta = factory({ defaultValue: false, key: "beta" })
    const theme = factory({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })
    const cache = createGateCache()
    await cache.prefetch(beta)
    await cache.prefetchBatch([beta, theme])
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decideMany).toHaveBeenCalledTimes(1)
  })

  it("returns the active cache and isolates bare providers", () => {
    const caches: unknown[] = []
    function Capture() {
      caches.push(useGateCache())
      return null
    }
    render(
      <>
        <GateProvider>
          <Capture />
        </GateProvider>
        <GateProvider>
          <Capture />
        </GateProvider>
      </>
    )
    expect(caches[0]).not.toBe(caches[1])
  })

  it("renders FeatureGate from an evaluator", async () => {
    const flag = makeFactory().factory({ defaultValue: false, key: "beta" })
    await renderAsync(
      <FeatureGate gate={flag} loading="loading" fallback="off">
        on
      </FeatureGate>
    )
    expect(await screen.findByText("on")).toBeTruthy()
  })

  it("renders variant matches", async () => {
    const flag = makeFactory().factory({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })
    await renderAsync(
      <FeatureGate gate={flag} loading="loading" match="dark">
        dark UI
      </FeatureGate>
    )
    expect(await screen.findByText("dark UI")).toBeTruthy()
  })

  it("invalidates through the hook cache using the provider identity", async () => {
    const { decide, factory } = makeFactory()
    const flag = factory({ defaultValue: false, key: "beta" })
    function Consumer() {
      const cache = useGateCache()
      const value = useGate(flag)
      return (
        <button
          type="button"
          onClick={() => {
            cache.invalidate(flag)
          }}
        >
          {String(value)}
        </button>
      )
    }
    await renderAsync(
      <GateProvider identity={{ distinctId: "provider" }}>
        <Suspense fallback="loading">
          <Consumer />
        </Suspense>
      </GateProvider>
    )
    expect(decide).toHaveBeenCalledTimes(1)
    await act(() => {
      screen.getByRole("button").click()
      return Promise.resolve()
    })
    expect(await screen.findByText("true")).toBeTruthy()
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it("applies the provider identity to hook cache prefetching", async () => {
    const seen: string[] = []
    const decideMany = mock((keys: readonly string[], identity: { distinctId: string }) => {
      seen.push(identity.distinctId)
      return Object.fromEntries(keys.map((key) => [key, decision.boolean(true)]))
    })
    const factory = buildGate({
      decide: (_key, identity) => {
        seen.push(identity.distinctId)
        return decision.boolean(true)
      },
      decideMany,
      identify: () => ({ distinctId: "core" }),
    })
    const beta = factory({ defaultValue: false, key: "beta" })
    let prefetching: Promise<void> | undefined
    function Runner() {
      const cache = useGateCache()
      return (
        <button
          type="button"
          onClick={() => {
            prefetching = (async () => {
              await cache.prefetch(beta)
              await cache.prefetchBatch([beta])
              cache.invalidateBatch([beta])
              await cache.prefetchBatch([beta])
            })()
          }}
        >
          run
        </button>
      )
    }
    render(
      <GateProvider identity={{ distinctId: "provider" }}>
        <Runner />
      </GateProvider>
    )
    await act(async () => {
      screen.getByRole("button").click()
      await prefetching
    })
    expect(seen).toEqual(["provider", "provider", "provider"])
    expect(decideMany).toHaveBeenCalledTimes(2)
  })

  it("invalidates a batch and clears the whole cache", async () => {
    const { decideMany, factory } = makeFactory()
    const beta = factory({ defaultValue: false, key: "beta" })
    const theme = factory({ defaultValue: "light", key: "theme", variants: ["light", "dark"] })
    const cache = createGateCache()
    function Consumer() {
      const [betaValue, themeValue] = useGateBatch([beta, theme])
      return <span>{`${betaValue}:${themeValue}`}</span>
    }
    await renderAsync(
      <GateProvider cache={cache}>
        <Suspense fallback="loading">
          <Consumer />
        </Suspense>
      </GateProvider>
    )
    expect(await screen.findByText("true:dark")).toBeTruthy()
    expect(decideMany).toHaveBeenCalledTimes(1)
    await act(() => {
      cache.invalidateBatch([beta, theme])
      return Promise.resolve()
    })
    expect(await screen.findByText("true:dark")).toBeTruthy()
    expect(decideMany).toHaveBeenCalledTimes(2)
    await act(() => {
      cache.clear()
      return Promise.resolve()
    })
    expect(await screen.findByText("true:dark")).toBeTruthy()
    expect(decideMany).toHaveBeenCalledTimes(3)
  })

  it("re-evaluates only for change notifications naming a subscribed key", async () => {
    let emit: ((keys: readonly string[]) => void) | undefined
    const decide = mock(() => decision.boolean(true))
    const factory = buildGate({
      decide,
      identify: () => ({ distinctId: "core" }),
      subscribe: (listener) => {
        emit = (keys) => {
          listener({ keys })
        }
        return () => null
      },
    })
    const flag = factory({ defaultValue: false, key: "beta" })
    function Consumer() {
      return <span>{String(useGate(flag))}</span>
    }
    await renderAsync(
      <GateProvider>
        <Suspense fallback="loading">
          <Consumer />
        </Suspense>
      </GateProvider>
    )
    expect(decide).toHaveBeenCalledTimes(1)
    await act(() => {
      emit?.(["other"])
      return Promise.resolve()
    })
    expect(decide).toHaveBeenCalledTimes(1)
    await act(() => {
      emit?.(["beta"])
      return Promise.resolve()
    })
    expect(await screen.findByText("true")).toBeTruthy()
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it("releases the version store when the last subscriber unmounts", async () => {
    const flag = makeFactory().factory({ defaultValue: false, key: "beta" })
    const cache = createGateCache()
    function Consumer() {
      return <span>{String(useGate(flag))}</span>
    }
    await renderAsync(
      <GateProvider cache={cache}>
        <Suspense fallback="loading">
          <Consumer />
        </Suspense>
      </GateProvider>
    )
    const stores = [
      ...(cache as unknown as { allBuckets: Set<{ stores: Map<string, unknown> }> }).allBuckets,
    ]
    expect(stores.some((bucket) => bucket.stores.size > 0)).toBe(true)
    cleanup()
    expect(stores.every((bucket) => bucket.stores.size === 0)).toBe(true)
  })

  it("evicts a rejected evaluation so a later read retries", async () => {
    const errors: unknown[] = []
    // oxlint-disable-next-line no-console -- Captures the development warning under test.
    const original = console.error
    // oxlint-disable-next-line no-console -- The warning under test is emitted through console.error.
    console.error = (...args: unknown[]) => errors.push(args[0])
    const call = mock(() => Promise.reject(new Error("boom")))
    const cache = createGateCache()
    function Consumer() {
      return <span>{useGate(call, { key: "retry" })}</span>
    }
    try {
      await renderAsync(
        <GateProvider cache={cache}>
          <ErrorBoundary>
            <Suspense fallback="loading">
              <Consumer />
            </Suspense>
          </ErrorBoundary>
        </GateProvider>
      )
      expect(await screen.findByText("failed")).toBeTruthy()
    } finally {
      // oxlint-disable-next-line no-console -- Restores the stub installed above.
      console.error = original
    }
    // The rejected entry is evicted on the next task, not synchronously.
    await Bun.sleep(1)
    cleanup()
    const call2 = mock(() => Promise.resolve(9))
    function Retry() {
      return <span>{useGate(call2, { key: "retry" })}</span>
    }
    await renderAsync(
      <GateProvider cache={cache}>
        <Suspense fallback="loading">
          <Retry />
        </Suspense>
      </GateProvider>
    )
    expect(await screen.findByText("9")).toBeTruthy()
  })

  it("rejects invalid cache options", () => {
    expect(() => createGateCache({ maxEntries: 0 })).toThrow(RangeError)
    expect(() => createGateCache({ maxEntries: 1.5 })).toThrow(RangeError)
    expect(() => createGateCache({ pendingTtlMs: 0 })).toThrow(RangeError)
    expect(() => createGateCache({ ttlMs: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })

  it("requires a key for the function form", () => {
    expect(() => render(<KeylessConsumer />)).toThrow("useGate(fn, options) requires a key option")
  })

  it("falls back when a variant gate has no match prop", async () => {
    const errors: unknown[] = []
    // oxlint-disable-next-line no-console -- Captures the development warning under test.
    const original = console.error
    // oxlint-disable-next-line no-console -- The warning under test is emitted through console.error.
    console.error = (...args: unknown[]) => errors.push(args[0])
    const flag = makeFactory().factory({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })
    try {
      await renderAsync(
        // @ts-expect-error -- omitting match is the misuse under test.
        <FeatureGate gate={flag} loading="loading" fallback="off">
          dark UI
        </FeatureGate>
      )
      expect(await screen.findByText("off")).toBeTruthy()
    } finally {
      // oxlint-disable-next-line no-console -- Restores the stub installed above.
      console.error = original
    }
    expect(errors.some((error) => String(error).includes("requires a match prop"))).toBe(true)
  })

  it("cleans up between tests", () => {
    cleanup()
    expect(document.body.textContent).toBe("")
  })
})

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? "failed" : this.props.children
  }
}

function KeylessConsumer() {
  // @ts-expect-error -- the key option is required for the function form.
  useGate(() => Promise.resolve(1))
  return null
}

function EmptyBatchConsumer() {
  return <span>{useGateBatch([]).length}</span>
}

function settledFactory() {
  const decide = mock(() => decision.boolean(true))
  const factory = buildGate({ decide, identify: () => ({ distinctId: "core" }) })
  return { decide, flag: factory({ defaultValue: false, key: "beta" }) }
}

describe("gate cache bounds", () => {
  it("evicts the least recently used settled evaluation", async () => {
    const { decide, flag } = settledFactory()
    const cache = createGateCache({ maxEntries: 2 })

    await cache.prefetch(flag, { identity: { distinctId: "first" } })
    await cache.prefetch(flag, { identity: { distinctId: "second" } })
    await Bun.sleep(1)
    await cache.prefetch(flag, { identity: { distinctId: "first" } })
    await cache.prefetch(flag, { identity: { distinctId: "third" } })
    await Bun.sleep(1)
    expect(decide).toHaveBeenCalledTimes(3)

    await cache.prefetch(flag, { identity: { distinctId: "second" } })
    expect(decide).toHaveBeenCalledTimes(4)
    await cache.prefetch(flag, { identity: { distinctId: "third" } })
    expect(decide).toHaveBeenCalledTimes(4)
  })

  it("expires settled evaluations after ttlMs", async () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const { decide, flag } = settledFactory()
    const cache = createGateCache({ ttlMs: 100 })

    await cache.prefetch(flag)
    now = 50
    await cache.prefetch(flag)
    expect(decide).toHaveBeenCalledTimes(1)

    now = 201
    await cache.prefetch(flag)
    expect(decide).toHaveBeenCalledTimes(2)
    dateNow.mockRestore()
  })
})
