"use server"

import { revalidatePath } from "next/cache"
import {
  clearServerCache,
  clearTelemetry,
  getProviderCalls,
  setFlakyKnobs,
} from "#shared/demo-provider/store"
import {
  anonymousDashboard,
  cachedDashboard,
  flakyFlag,
  hookErrorGate,
  malformedGate,
  newDashboard,
} from "#shared/gates/server"
import { getIdentity } from "#shared/server/user"

export type DemoResult = { title: string; summary: string; detail: string }

export async function runDedupe(_previous: DemoResult | null): Promise<DemoResult> {
  const identity = (await getIdentity()) ?? { distinctId: "alice" as const }
  const before = getProviderCalls()
  const values = await Promise.all(Array.from({ length: 5 }, () => newDashboard({ identity })))
  const calls = getProviderCalls() - before
  return {
    title: "Dedupe result",
    summary: `5 evaluations → ${calls} provider call${calls === 1 ? "" : "s"}`,
    detail: `values: ${values.join(", ")}`,
  }
}

export async function runCache(_previous: DemoResult | null): Promise<DemoResult> {
  const identity = (await getIdentity()) ?? { distinctId: "alice" as const }
  clearServerCache()
  const before = getProviderCalls()
  const first = await cachedDashboard.details({ identity })
  const afterMiss = getProviderCalls()
  const second = await cachedDashboard.details({ identity })
  const afterHit = getProviderCalls()
  return {
    title: "Cache result",
    summary: `miss: ${afterMiss - before} call · hit: ${afterHit - afterMiss} calls`,
    detail: `sources: ${first.source} → ${second.source}; values: ${first.value}, ${second.value}`,
  }
}

export async function runTimeout(_previous: DemoResult | null): Promise<DemoResult> {
  const identity = (await getIdentity()) ?? { distinctId: "alice" as const }
  setFlakyKnobs(1500, false)
  try {
    const result = await flakyFlag.details({ identity })
    return {
      title: "Timeout result",
      summary: `${result.value} from ${result.source}`,
      detail: result.error ? `${result.error.name}: ${result.error.message}` : "No fallback error",
    }
  } finally {
    setFlakyKnobs(0, false)
  }
}

export async function clearAdvancedTelemetry(): Promise<void> {
  clearTelemetry()
  revalidatePath("/advanced")
}

export async function clearAdvancedCache(): Promise<void> {
  clearServerCache()
  revalidatePath("/advanced")
}

export async function generateAdvancedEvidence(): Promise<void> {
  clearTelemetry()
  setFlakyKnobs(0, true)
  try {
    await Promise.all([
      hookErrorGate(),
      malformedGate.details(),
      anonymousDashboard.details(),
      flakyFlag.details(),
    ])
  } finally {
    setFlakyKnobs(0, false)
  }
  revalidatePath("/advanced")
}
