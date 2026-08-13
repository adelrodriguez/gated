"use client"

import { buildGate, type Decision } from "gated"
import { useGate } from "gated/react"
import type { DemoIdentity } from "#shared/flags"

let clientFetches = 0

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  clientFetches += 1
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok)
    throw new Error(((await response.json()) as { error?: string }).error ?? "Request failed")
  return response.json() as Promise<T>
}

export function getClientFetches(): number {
  return clientFetches
}

// This is consumer-facing gated setup. The HTTP routes hide the showcase-only provider store.
export const clientGate = buildGate({
  identify: (): DemoIdentity => ({ distinctId: "alice" }),
  decide: (key, identity, options) =>
    post<Decision>("/api/decide", { key, identity }, options?.signal),
  decideMany: (keys, identity, options) =>
    post<Record<string, Decision>>("/api/decide-many", { keys, identity }, options?.signal),
})

export const clientNewDashboard = clientGate({ key: "new-dashboard", defaultValue: false })
export const clientBetaBanner = clientGate({ key: "beta-banner", defaultValue: false })
export const clientCheckoutTheme = clientGate({
  key: "checkout-theme",
  defaultValue: "system",
  variants: ["light", "dark", "system"],
})
export const clientFlakyFlag = clientGate({ key: "flaky-flag", defaultValue: false })

async function audienceLabel(
  identity: DemoIdentity,
  prefix: string
): Promise<"enabled" | "disabled"> {
  const value = await clientNewDashboard({ identity })
  return value ? "enabled" : "disabled"
}
export function useAudienceLabel(identity: DemoIdentity, prefix: string) {
  return useGate(() => audienceLabel(identity, prefix), {
    key: [identity.distinctId, prefix],
  })
}
