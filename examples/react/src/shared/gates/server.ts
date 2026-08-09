import "server-only"

import { buildGate, decision, defineHook, type Hook } from "gated"
import { cacheHook, dedupeHook } from "gated/hooks/recipes"
import type { DemoIdentity } from "#shared/flags"
import { demoProvider } from "#shared/demo-provider/adapter"
import { recordLifecycleEvent, visibleCache } from "#shared/demo-provider/store"
import { getIdentity } from "#shared/server/user"

// This is consumer-facing gated setup. The showcase-only provider lives in shared/demo-provider.
const loggingHook = defineHook<DemoIdentity>({
  before(context) {
    recordLifecycleEvent({
      phase: "before",
      flagKey: context.flagKey,
      distinctId: context.identity?.distinctId ?? null,
      detail: `kind=${context.kind}`,
    })
  },
  resolve(context) {
    recordLifecycleEvent({
      phase: "resolve",
      flagKey: context.flagKey,
      distinctId: context.identity?.distinctId ?? null,
      detail: "continuing to provider",
    })
  },
  after(context, _result, meta) {
    recordLifecycleEvent({
      phase: "after",
      flagKey: context.flagKey,
      distinctId: context.identity?.distinctId ?? null,
      detail: `source=${meta.source}`,
    })
  },
  error(context, error) {
    recordLifecycleEvent({
      phase: "error",
      flagKey: context.flagKey,
      distinctId: context.identity?.distinctId ?? null,
      detail: `${error.name}: ${error.message}`,
    })
  },
  finally(context) {
    recordLifecycleEvent({
      phase: "finally",
      flagKey: context.flagKey,
      distinctId: context.identity?.distinctId ?? null,
      detail: "evaluation complete",
    })
  },
})

function onHookError(report: {
  phase: string
  hookIndex: number
  error: Error
  context: { flagKey: string; identity: DemoIdentity | null }
}): void {
  recordLifecycleEvent({
    phase: "hook-error",
    flagKey: report.context.flagKey,
    distinctId: report.context.identity?.distinctId ?? null,
    detail: `hook #${report.hookIndex} ${report.phase}: ${report.error.message}`,
  })
}

export const gate = buildGate({
  identify: getIdentity,
  ...demoProvider,
  hooks: [loggingHook, dedupeHook()],
  onHookError,
  timeoutMs: 1000,
})

const cachedGate = buildGate({
  identify: getIdentity,
  ...demoProvider,
  hooks: [loggingHook, cacheHook(visibleCache), dedupeHook()],
  onHookError,
  timeoutMs: 1000,
})

const anonymousGate = buildGate({
  anonymous: "allow",
  identify: getIdentity,
  ...demoProvider,
  hooks: [loggingHook, dedupeHook()],
  onHookError,
  timeoutMs: 1000,
})

export const newDashboard = gate({ key: "new-dashboard", defaultValue: false })
export const betaBanner = gate({ key: "beta-banner", defaultValue: false })
export const checkoutTheme = gate({
  key: "checkout-theme",
  defaultValue: "system",
  variants: ["light", "dark", "system"],
})
export const pricingExperiment = gate({
  key: "pricing-experiment",
  defaultValue: "control",
  variants: ["control", "a", "b"],
})
export const flakyFlag = gate({ key: "flaky-flag", defaultValue: false })

export const cachedDashboard = cachedGate({ key: "new-dashboard", defaultValue: false })
export const anonymousDashboard = anonymousGate({ key: "new-dashboard", defaultValue: false })

export const malformedGate = buildGate({
  identify: getIdentity,
  decide: () => ({ value: "not a discriminated decision" }) as never,
})({ key: "malformed-demo", defaultValue: false })

const throwingHook: Hook<DemoIdentity> = {
  before() {
    throw new Error("Deliberate hook failure")
  },
}
export const hookErrorGate = buildGate({
  identify: getIdentity,
  decide: () => decision.boolean(true),
  hooks: [throwingHook],
  onHookError,
})({ key: "hook-error-demo", defaultValue: false })

export const allMainGates = [
  newDashboard,
  betaBanner,
  checkoutTheme,
  pricingExperiment,
  flakyFlag,
] as const
