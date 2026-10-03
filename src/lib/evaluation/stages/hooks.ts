import type {
  Decision,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
} from "#lib/types"
import { reportInBackground } from "#lib/shared/report"
import { normalizeError } from "#lib/shared/utils"

type HookErrorReporter<TIdentity extends Identity> = GatedConfig<TIdentity>["onHookError"]

function reportRejectedHooks<TIdentity extends Identity>(
  results: Array<PromiseSettledResult<void>>,
  phase: HookErrorReport["phase"],
  hookContext: HookContext<TIdentity>,
  reporter: HookErrorReporter<TIdentity>
) {
  results.forEach((result, hookIndex) => {
    if (result.status === "rejected") {
      const error = normalizeError(result.reason)
      reportInBackground(reporter, {
        context: hookContext,
        error,
        hookIndex,
        phase,
      })
    }
  })
}

export async function runBeforeHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.before?.(hookContext)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "before", hookContext, reporter)
}

export async function runAfterHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  decision: Decision,
  meta: { source: "cache" | "provider" },
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) =>
    Promise.resolve().then(() => hook.after?.(hookContext, decision, meta))
  )
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "after", hookContext, reporter)
}

export async function runErrorHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  error: Error,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.error?.(hookContext, error)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "error", hookContext, reporter)
}

export async function runFinallyHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
) {
  const tasks = hooks.map((hook) => Promise.resolve().then(() => hook.finally?.(hookContext)))
  const results = await Promise.allSettled(tasks)

  reportRejectedHooks(results, "finally", hookContext, reporter)
}
