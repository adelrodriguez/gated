import type { IdentityValue } from "gated"
import type { FlagKey, UserId } from "#shared/flags"

type BooleanConfig = {
  kind: "boolean"
  value: boolean
  overrides: Partial<Record<UserId, boolean>>
  latencyMs: number
  fail: boolean
}

type VariantConfig = {
  kind: "variant"
  value: string
  overrides: Partial<Record<UserId, string>>
  payload?: IdentityValue
  latencyMs: number
  fail: boolean
}

export type FlagConfig = BooleanConfig | VariantConfig
export type LogPhase = "before" | "after" | "error" | "finally" | "hook-error"
export type LogEntry = {
  id: number
  timestamp: string
  phase: LogPhase
  flagKey: string
  distinctId: string | null
  detail: string
}

export function seedFlags(): Record<FlagKey, FlagConfig> {
  return {
    "new-dashboard": {
      kind: "boolean",
      value: true,
      overrides: { bob: false },
      latencyMs: 0,
      fail: false,
    },
    "beta-banner": {
      kind: "boolean",
      value: false,
      overrides: { carol: true },
      latencyMs: 0,
      fail: false,
    },
    "checkout-theme": {
      kind: "variant",
      value: "system",
      overrides: { alice: "light", bob: "dark" },
      payload: { accent: "violet", updatedAt: "2026-08-09" },
      latencyMs: 0,
      fail: false,
    },
    "pricing-experiment": {
      kind: "variant",
      value: "control",
      overrides: { bob: "a", carol: "b" },
      latencyMs: 0,
      fail: false,
    },
    "flaky-flag": {
      kind: "boolean",
      value: true,
      overrides: {},
      latencyMs: 0,
      fail: false,
    },
  }
}
