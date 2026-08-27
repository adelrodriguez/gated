import "server-only"

import { decision, type Decision } from "gated"
import type { UserId } from "#shared/flags"
import { readProviderFlag, recordProviderCall } from "#shared/demo-provider/store"

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}

async function decide(
  key: string,
  identity: { distinctId: string } | null,
  options?: { signal?: AbortSignal }
): Promise<Decision> {
  recordProviderCall()
  const flag = readProviderFlag(key)
  if (!flag) return decision.boolean(false)
  await abortableDelay(flag.latencyMs, options?.signal)
  if (flag.fail) throw new Error(`Simulated provider failure for ${key}`)
  const user = identity?.distinctId as UserId | undefined

  if (flag.kind === "boolean") {
    return decision.boolean((user && flag.overrides[user]) ?? flag.value)
  }
  return decision.variant((user && flag.overrides[user]) ?? flag.value, flag.payload)
}

async function decideMany(
  keys: readonly string[],
  identity: { distinctId: string } | null,
  options?: { signal?: AbortSignal }
): Promise<Record<string, Decision>> {
  recordProviderCall()
  const output: Record<string, Decision> = {}
  await Promise.all(
    keys.map(async (key) => {
      const flag = readProviderFlag(key)
      if (!flag) {
        output[key] = decision.boolean(false)
        return
      }
      await abortableDelay(flag.latencyMs, options?.signal)
      if (flag.fail) throw new Error(`Simulated provider failure for ${key}`)
      const user = identity?.distinctId as UserId | undefined
      output[key] =
        flag.kind === "boolean"
          ? decision.boolean((user && flag.overrides[user]) ?? flag.value)
          : decision.variant((user && flag.overrides[user]) ?? flag.value, flag.payload)
    })
  )
  return output
}

/**
 * Fake provider adapter used only by this example. Consumer gate configuration depends on this
 * small interface and does not need to know how the in-memory store or simulation knobs work.
 */
export const demoProvider = { decide, decideMany }
