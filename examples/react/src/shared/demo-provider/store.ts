import "server-only"

import type { Decision } from "gated"
import type { FlagKey, UserId } from "#shared/flags"
import { seedFlags, type FlagConfig, type LogEntry } from "#shared/demo-provider/model"

type DemoProviderState = {
  flags: Record<FlagKey, FlagConfig>
  log: LogEntry[]
  providerCalls: number
  nextLogId: number
  cache: Map<string, Decision>
}

const root = globalThis as typeof globalThis & {
  __gatedShowcaseStore?: DemoProviderState
}

function getState(): DemoProviderState {
  root.__gatedShowcaseStore ??= {
    flags: seedFlags(),
    log: [],
    providerCalls: 0,
    nextLogId: 1,
    cache: new Map(),
  }
  return root.__gatedShowcaseStore
}

/**
 * Internal seam used by the demo provider adapter.
 */
export function readProviderFlag(key: string): FlagConfig | undefined {
  return getState().flags[key as FlagKey]
}

/**
 * Internal seam used by the demo provider adapter.
 */
export function recordProviderCall(): void {
  getState().providerCalls += 1
}

export function snapshotFlags(): Record<FlagKey, FlagConfig> {
  return structuredClone(getState().flags)
}

export function recordLifecycleEvent(entry: Omit<LogEntry, "id" | "timestamp">): void {
  const state = getState()
  state.log.push({ ...entry, id: state.nextLogId++, timestamp: new Date().toISOString() })
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200)
}

export function getLog(): LogEntry[] {
  return getState().log.toReversed()
}

export function getProviderCalls(): number {
  return getState().providerCalls
}

export function clearTelemetry(): void {
  const state = getState()
  state.log = []
  state.providerCalls = 0
}

export function resetStore(): void {
  const state = getState()
  state.flags = seedFlags()
  state.log = []
  state.providerCalls = 0
  state.cache.clear()
}

export function setGlobalValue(key: FlagKey, value: boolean | string): void {
  const flag = getState().flags[key]
  if (flag.kind === "boolean" && typeof value === "boolean") flag.value = value
  if (flag.kind === "variant" && typeof value === "string") flag.value = value
}

export function setOverride(key: FlagKey, user: UserId, value: boolean | string | null): void {
  const flag = getState().flags[key]
  if (value === null) {
    delete flag.overrides[user]
  } else if (flag.kind === "boolean" && typeof value === "boolean") {
    flag.overrides[user] = value
  } else if (flag.kind === "variant" && typeof value === "string") {
    flag.overrides[user] = value
  }
}

export function setFlakyKnobs(latencyMs: number, fail: boolean): void {
  const flag = getState().flags["flaky-flag"]
  flag.latencyMs = Math.max(0, Math.min(10_000, latencyMs))
  flag.fail = fail
}

export function clearServerCache(): void {
  getState().cache.clear()
}

export const visibleCache = {
  async get(key: string): Promise<Decision | undefined> {
    return getState().cache.get(key)
  },
  async set(key: string, value: Decision): Promise<void> {
    getState().cache.set(key, value)
  },
}
