import type {
  AfterHookMeta,
  Decision,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  MaybePromise,
} from "./types"
import { HookResolutionAbortError, normalizeError } from "./internal"
import { abortReason } from "./signals"

type HookErrorReporter<TIdentity extends Identity> = GatedConfig<TIdentity>["onHookError"]

type HookResolution<TIdentity extends Identity> = {
  decision: Decision
  resolver: Hook<TIdentity>
}

export function reportInBackground<TReport>(
  reporter: ((report: TReport) => MaybePromise<void>) | undefined,
  report: TReport
): void {
  if (!reporter) {
    return
  }

  void Promise.resolve()
    .then(() => reporter(report))
    .catch(() => null)
}

export function reportHookError<TIdentity extends Identity>(
  reporter: HookErrorReporter<TIdentity>,
  report: HookErrorReport<TIdentity>
): void {
  reportInBackground(reporter, report)
}

function reportRejectedHooks<TIdentity extends Identity>(
  results: Array<PromiseSettledResult<void>>,
  phase: HookErrorReport["phase"],
  hookContext: HookContext<TIdentity>,
  reporter: HookErrorReporter<TIdentity>
) {
  results.forEach((result, hookIndex) => {
    if (result.status === "rejected") {
      const error = normalizeError(result.reason)
      reportHookError(reporter, {
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

export async function runResolveHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  validate: (decision: Decision) => void,
  reporter?: HookErrorReporter<TIdentity>
): Promise<HookResolution<TIdentity> | undefined> {
  for (const [hookIndex, hook] of hooks.entries()) {
    if (hookContext.signal.aborted) {
      throw abortReason(hookContext.signal)
    }

    try {
      // oxlint-disable-next-line no-await-in-loop
      const value = await Promise.resolve().then(() => hook.resolve?.(hookContext))

      if (value !== undefined && value !== null) {
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- Required by TypeScript 5.x.
        const decision = value as Decision
        validate(decision)
        return { decision, resolver: hook }
      }
    } catch (error) {
      if (error instanceof HookResolutionAbortError) {
        throw error.originalError
      }

      reportHookError(reporter, {
        context: hookContext,
        error: normalizeError(error),
        hookIndex,
        phase: "resolve",
      })
    }
  }

  return undefined
}

export async function runAfterHooks<TIdentity extends Identity>(
  hooks: Array<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  decision: Decision,
  meta: AfterHookMeta<TIdentity>,
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
