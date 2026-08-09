import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, Identity, IdentityValue } from "../lib/types"
import { buildGate } from "../core"
import { cacheHook, dedupeHook } from "../hooks/recipes"

async function expectRejection(promise: Promise<IdentityValue>, message: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toHaveProperty("message", message)
    return
  }
  throw new Error("Expected snapshot to reject")
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

describe("gate snapshots", () => {
  test("resolves identity once and batches unresolved flags", async () => {
    const identity = { distinctId: "user123" }
    const identify = mock(() => identity)
    const decide = mock(() => {
      throw new Error("single decision should not run")
    })
    const decideMany = mock(() => ({
      "beta-access": { type: "boolean", value: true } as const,
      theme: { type: "variant", variant: "dark" } as const,
    }))
    const gate = buildGate({ decide, decideMany, identify })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme] as const)
    const booleanValue: boolean = snapshot.get(betaAccess)
    const variantValue: "light" | "dark" = snapshot.get(theme)

    expect(booleanValue).toBe(true)
    expect(variantValue).toBe("dark")
    expect(identify).toHaveBeenCalledTimes(1)
    expect(decideMany).toHaveBeenCalledWith(["beta-access", "theme"], identity, expect.any(Object))
    expect(decide).not.toHaveBeenCalled()
  })

  test("exposes typed evaluation details and variant payloads", async () => {
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: false }),
      decideMany: () => ({
        broken: { type: "variant", variant: "invalid" },
        theme: { payload: { campaign: "summer" }, type: "variant", variant: "dark" },
      }),
      identify: () => ({ distinctId: "user123" }),
    })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })
    const broken = gate({ defaultValue: false, key: "broken" })

    const snapshot = await gate.snapshot([theme, broken] as const)
    const themeDetails = snapshot.details(theme)
    const brokenDetails = snapshot.details(broken)

    expect(themeDetails).toEqual({
      flagKey: "theme",
      payload: { campaign: "summer" },
      source: "provider",
      value: "dark",
    })
    expect(brokenDetails.source).toBe("default")
    expect(brokenDetails.value).toBe(false)
    expect(brokenDetails.error).toBeInstanceOf(Error)
  })

  test("omits hook-resolved flags and runs every lifecycle", async () => {
    const phases: string[] = []
    const hook: Hook = {
      after: (context) => {
        phases.push(`${context.flagKey}:after`)
      },
      before: (context) => {
        phases.push(`${context.flagKey}:before`)
      },
      finally: (context) => {
        phases.push(`${context.flagKey}:finally`)
      },
      resolve: (context) => {
        phases.push(`${context.flagKey}:resolve`)
        return context.flagKey === "beta-access" ? { type: "boolean", value: true } : undefined
      },
    }
    const decideMany = mock(() => ({
      theme: { type: "variant", variant: "dark" } as const,
    }))
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: false }),
      decideMany,
      hooks: [hook],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme])

    expect(snapshot.get(betaAccess)).toBe(true)
    expect(snapshot.get(theme)).toBe("dark")
    expect(decideMany).toHaveBeenCalledWith(["theme"], expect.any(Object), expect.any(Object))
    expect(phases.filter((phase) => phase.startsWith("beta-access:"))).toEqual([
      "beta-access:before",
      "beta-access:resolve",
      "beta-access:after",
      "beta-access:finally",
    ])
    expect(phases.filter((phase) => phase.startsWith("theme:"))).toEqual([
      "theme:before",
      "theme:resolve",
      "theme:after",
      "theme:finally",
    ])
  })

  test("isolates an invalid decision to its flag", async () => {
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: false }),
      decideMany: () => ({
        "beta-access": { type: "boolean", value: true },
        theme: { type: "variant", variant: "purple" },
      }),
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme])

    expect(snapshot.get(betaAccess)).toBe(true)
    expect(snapshot.get(theme)).toBe("light")
  })

  test("isolates a rejected batch while preserving hook-resolved flags", async () => {
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      decideMany: () => Promise.reject(new Error("provider unavailable")),
      hooks: [
        {
          resolve: (context) =>
            context.flagKey === "hooked" ? { type: "boolean", value: true } : undefined,
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })
    const hooked = gate({ defaultValue: false, key: "hooked" })
    const unresolved = gate({ defaultValue: false, key: "unresolved" })

    const snapshot = await gate.snapshot([hooked, unresolved])

    expect(snapshot.get(hooked)).toBe(true)
    expect(snapshot.get(unresolved)).toBe(false)
  })

  test("falls back to one single decision for a missing batch key", async () => {
    const decide = mock((key: string) =>
      key === "theme"
        ? ({ type: "variant", variant: "dark" } as const)
        : ({ type: "boolean", value: false } as const)
    )
    const gate = buildGate({
      decide,
      decideMany: () => ({ "beta-access": { type: "boolean", value: true } }),
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme])

    expect(snapshot.get(betaAccess)).toBe(true)
    expect(snapshot.get(theme)).toBe("dark")
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledWith("theme", expect.any(Object), expect.any(Object))
  })

  test("does not treat inherited record properties as batch decisions", async () => {
    const decide = mock(() => ({ type: "boolean", value: true }) as const)
    const gate = buildGate({
      decide,
      decideMany: () => ({}),
      identify: () => ({ distinctId: "user123" }),
    })
    const inheritedKey = gate({ defaultValue: false, key: "toString" })

    const snapshot = await gate.snapshot([inheritedKey])

    expect(snapshot.get(inheritedKey)).toBe(true)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  test("uses parallel single decisions when decideMany is absent", async () => {
    const decide = mock((key: string): Decision =>
      key === "theme" ? { type: "variant", variant: "dark" } : { type: "boolean", value: true }
    )
    const gate = buildGate({
      decide,
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme])

    expect(snapshot.get(betaAccess)).toBe(true)
    expect(snapshot.get(theme)).toBe("dark")
    expect(decide).toHaveBeenCalledTimes(2)
  })

  test("integrates with cache and dedupe without hanging", async () => {
    const stored = new Map<string, Decision>([
      ["beta-access:user123", { type: "boolean", value: true }],
    ])
    const cache = {
      get: mock((key: string) => Promise.resolve(stored.get(key))),
      set: mock((key: string, value: Decision) => {
        stored.set(key, value)
        return Promise.resolve()
      }),
    }
    const decide = mock(() => ({ type: "variant", variant: "dark" }) as const)
    const decideMany = mock(() => ({
      theme: { type: "variant", variant: "dark" } as const,
    }))
    const gate = buildGate({
      decide,
      decideMany,
      hooks: [dedupeHook(), cacheHook(cache)],
      identify: () => ({ distinctId: "user123" }),
    })
    const betaAccess = gate({ defaultValue: false, key: "beta-access" })
    const theme = gate({
      defaultValue: "light",
      key: "theme",
      variants: ["light", "dark"],
    })

    const snapshot = await gate.snapshot([betaAccess, theme])

    expect(snapshot.get(betaAccess)).toBe(true)
    expect(snapshot.get(theme)).toBe("dark")
    expect(decideMany).toHaveBeenCalledWith(["theme"], expect.any(Object), expect.any(Object))
    expect(cache.set).toHaveBeenCalledWith("theme:user123", {
      type: "variant",
      variant: "dark",
    })
  })

  test("does not deadlock concurrent snapshots with cross-key dedupe leaders", async () => {
    const invocationCount = new Map<string, number>()
    const dispatchedKeys = new Set<string>()
    let releaseBatches!: () => void
    const bothLeadersDispatched = new Promise<void>((resolve) => {
      releaseBatches = resolve
    })
    const skewedHook: Hook = {
      async resolve(context) {
        const count = (invocationCount.get(context.flagKey) ?? 0) + 1
        invocationCount.set(context.flagKey, count)
        if (
          (context.flagKey === "first" && count === 2) ||
          (context.flagKey === "second" && count === 1)
        ) {
          await delay(20)
        }
      },
    }
    const decideMany = mock(async (keys: readonly string[]) => {
      for (const key of keys) {
        dispatchedKeys.add(key)
      }
      if (dispatchedKeys.size === 2) {
        releaseBatches()
      }
      await bothLeadersDispatched
      await delay(40)
      return Object.fromEntries(keys.map((key) => [key, { type: "boolean", value: true } as const]))
    })
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      decideMany,
      hooks: [skewedHook, dedupeHook()],
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 200,
    })
    const first = gate({ defaultValue: false, key: "first" })
    const second = gate({ defaultValue: false, key: "second" })

    const [firstSnapshot, secondSnapshot] = await Promise.all([
      gate.snapshot([first, second]),
      gate.snapshot([first, second]),
    ])

    expect(firstSnapshot.get(first)).toBe(true)
    expect(firstSnapshot.get(second)).toBe(true)
    expect(secondSnapshot.get(first)).toBe(true)
    expect(secondSnapshot.get(second)).toBe(true)
    expect(decideMany).toHaveBeenCalledTimes(2)
  })

  test("shares one caller abort signal across hooks and cancels the batch on exit", async () => {
    const hookSignals: AbortSignal[] = []
    let batchSignal: AbortSignal | undefined
    let batchAbortedDuringCall: boolean | undefined
    const controller = new AbortController()
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: false }),
      decideMany: (keys, identity, options) => {
        void keys
        void identity
        batchSignal = options?.signal
        batchAbortedDuringCall = options?.signal?.aborted
        return {
          first: { type: "boolean", value: true },
          second: { type: "boolean", value: true },
        }
      },
      hooks: [
        {
          before: (context) => {
            hookSignals.push(context.signal)
          },
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })
    const first = gate({ defaultValue: false, key: "first" })
    const second = gate({ defaultValue: false, key: "second" })

    await gate.snapshot([first, second], { signal: controller.signal })

    expect(hookSignals).toHaveLength(2)
    expect(hookSignals[0]).toBe(controller.signal)
    expect(hookSignals[1]).toBe(controller.signal)
    expect(batchAbortedDuringCall).toBe(false)
    expect(batchSignal?.aborted).toBe(true)
  })

  test("preserves a per-gate timeout that is longer than the factory default", async () => {
    const gate = buildGate({
      decide: async () => {
        await delay(40)
        return { type: "boolean", value: true }
      },
      identify: () => ({ distinctId: "user123" }),
      timeoutMs: 10,
    })
    const factoryTimed = gate({ defaultValue: false, key: "factory-timed" })
    const slow = gate({ defaultValue: false, key: "slow", timeoutMs: 100 })

    const snapshot = await gate.snapshot([factoryTimed, slow])

    expect(snapshot.get(factoryTimed)).toBe(false)
    expect(snapshot.details(factoryTimed).source).toBe("default")
    expect(snapshot.get(slow)).toBe(true)
    expect(snapshot.details(slow).source).toBe("provider")
  })

  test("gives the single-decision fallback the flag's own deadline", async () => {
    const signals: Record<string, AbortSignal | undefined> = {}
    const gate = buildGate({
      decide: async (key, _identity, options) => {
        signals[key] = options?.signal
        await delay(200)
        return { type: "boolean", value: true }
      },
      identify: () => ({ distinctId: "user123" }),
    })
    const capped = gate({ defaultValue: false, key: "capped", timeoutMs: 20 })
    const unbounded = gate({ defaultValue: false, key: "unbounded" })

    await gate.snapshot([capped, unbounded])

    expect(signals.capped?.aborted).toBe(true)
    expect(signals.unbounded?.aborted).toBe(false)
  })

  test("stops a flag's signal from aborting once that flag has settled", async () => {
    const signals: Record<string, AbortSignal> = {}
    const gate = buildGate({
      decide: async (key) => {
        await delay(key === "fast" ? 5 : 150)
        return { type: "boolean", value: true }
      },
      hooks: [
        {
          before: (context) => {
            signals[context.flagKey] = context.signal
          },
        },
      ],
      identify: () => ({ distinctId: "user123" }),
    })
    const fast = gate({ defaultValue: false, key: "fast", timeoutMs: 50 })
    const slow = gate({ defaultValue: false, key: "slow", timeoutMs: 5000 })

    const snapshot = await gate.snapshot([fast, slow])

    expect(snapshot.get(fast)).toBe(true)
    expect(signals.fast?.aborted).toBe(false)
  })

  test("passes null identity to anonymous batches without deduplicating snapshots", async () => {
    const decideMany = mock((keys: readonly string[], identity: Identity | null) => {
      expect(identity).toBeNull()
      return Object.fromEntries(keys.map((key) => [key, { type: "boolean", value: true } as const]))
    })
    const gate = buildGate({
      anonymous: "allow",
      decide: () => ({ type: "boolean", value: false }),
      decideMany,
      hooks: [dedupeHook()],
      identify: () => null,
    })
    const anonymous = gate({ defaultValue: false, key: "anonymous" })

    const [first, second] = await Promise.all([
      gate.snapshot([anonymous]),
      gate.snapshot([anonymous]),
    ])

    expect(first.get(anonymous)).toBe(true)
    expect(second.get(anonymous)).toBe(true)
    expect(decideMany).toHaveBeenCalledTimes(2)
  })

  test("rejects duplicate keys before identity or provider work", async () => {
    const identify = mock(() => ({ distinctId: "user123" }))
    const decide = mock(() => ({ type: "boolean", value: true }) as const)
    const gate = buildGate({ decide, identify })
    const first = gate({ defaultValue: false, key: "duplicate" })
    const second = gate({ defaultValue: true, key: "duplicate" })

    await expectRejection(
      gate.snapshot([first, second]),
      "Snapshot requires unique flag keys; duplicate: duplicate"
    )
    expect(identify).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
  })

  test("rejects legacy bare-identity snapshot options", async () => {
    const gate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "identified" }),
    })
    const flag = gate({ defaultValue: false, key: "flag" })

    await expectRejection(
      // @ts-expect-error -- Snapshot options use the same { identity } shape as evaluators.
      gate.snapshot([flag], { distinctId: "legacy-user" }),
      "Gate evaluators now accept an options object; pass the identity as { identity }."
    )
  })

  test("rejects evaluators from another factory", async () => {
    const firstGate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
    })
    const secondGate = buildGate({
      decide: () => ({ type: "boolean", value: true }),
      identify: () => ({ distinctId: "user123" }),
    })
    const foreign = secondGate({ defaultValue: false, key: "foreign" })

    await expectRejection(
      firstGate.snapshot([foreign]),
      "Snapshot flags must be created by this gate factory"
    )
  })
})
