import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { act, Component, type ReactNode, Suspense } from "react"
import type { Identity } from "../lib/types"
import {
  createReactGate,
  createReactGateCache,
  FeatureGate,
  type ReactGate,
} from "../integrations/react"

afterEach(() => {
  cleanup()
})

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
} {
  let rejectPromise!: (error: unknown) => void
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

  override render(): ReactNode {
    return this.state.error ? (
      <div data-testid="error">{this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

describe("createReactGateCache", () => {
  test("uses least-recently-used eviction", () => {
    const cache = createReactGateCache({ maxEntries: 2, ttlMs: 1000 })
    const first = Promise.resolve(true)
    const second = Promise.resolve(false)
    const third = Promise.resolve(true)

    cache.set("first", first)
    cache.set("second", second)
    expect(cache.get("first")).toBe(first)
    cache.set("third", third)

    expect(cache.get("second")).toBeUndefined()
    expect(cache.get("first")).toBe(first)
    expect(cache.get("third")).toBe(third)
  })

  test("expires entries after their TTL", () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const cache = createReactGateCache({ ttlMs: 100 })
    cache.set("flag", Promise.resolve(true))

    now = 101

    expect(cache.get("flag")).toBeUndefined()
    dateNow.mockRestore()
  })

  test("rejects invalid bounds", () => {
    expect(() => createReactGateCache({ maxEntries: 0 })).toThrow(RangeError)
    expect(() => createReactGateCache({ maxEntries: 1.5 })).toThrow(RangeError)
    expect(() => createReactGateCache({ ttlMs: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})

describe("createReactGate", () => {
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

  test("uses stable identity keys", async () => {
    type TestIdentity = Identity & { plan: string }
    const gateFn = mock((identity?: TestIdentity) => Promise.resolve(identity?.plan === "pro"))
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

  test("evaluates different identities independently", async () => {
    const gateFn = mock((identity?: Identity) =>
      Promise.resolve(identity?.distinctId === "enabled")
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

  test("evicts rejected evaluations so a later render retries", async () => {
    let invocation = 0
    const gateFn = mock(() => {
      invocation += 1
      return invocation === 1
        ? Promise.reject(new Error("provider unavailable"))
        : Promise.resolve(true)
    })
    const useBetaAccess = createReactGate(gateFn)
    const consoleError = spyOn(console, "error").mockImplementation(() => false)

    let firstRender!: ReturnType<typeof render>
    await act(async () => {
      firstRender = render(
        <ErrorBoundary>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        </ErrorBoundary>
      )
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("provider unavailable")
    })
    firstRender.unmount()

    await act(async () => {
      render(
        <ErrorBoundary>
          <Suspense fallback="Loading">
            <GateValue gate={useBetaAccess} />
          </Suspense>
        </ErrorBoundary>
      )
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
})

describe("FeatureGate", () => {
  test("shows loading while an async gate suspends inside its boundary", async () => {
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

  test("passes the override identity to the gate", () => {
    type TestIdentity = Identity & { plan: "free" | "pro" }
    const gate = mock((identity?: TestIdentity) => identity?.plan === "pro")
    const identity: TestIdentity = { distinctId: "user-1", plan: "pro" }

    render(
      <FeatureGate gate={gate} overrideIdentity={identity}>
        <div data-testid="feature">Pro</div>
      </FeatureGate>
    )

    expect(screen.getByTestId("feature").textContent).toBe("Pro")
    expect(gate).toHaveBeenCalledWith(identity)
  })

  test("warns and renders fallback when a string gate has no match", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => false)
    const variantGate = (() => "dark") as unknown as () => boolean

    render(
      <FeatureGate fallback={<div data-testid="fallback">No match</div>} gate={variantGate}>
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
