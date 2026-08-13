import { afterEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, render, screen } from "@testing-library/react"
import { type ReactNode, Suspense } from "react"
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

  it("cleans up between tests", () => {
    cleanup()
    expect(document.body.textContent).toBe("")
  })
})

function EmptyBatchConsumer() {
  return <span>{useGateBatch([]).length}</span>
}
