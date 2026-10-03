import type {
  Decision,
  DecisionSource,
  GatedConfig,
  Hook,
  HookContext,
  HookErrorReport,
  Identity,
  MaybePromise,
} from "#lib/types"
import { reportInBackground } from "#lib/shared/report"
import { normalizeError } from "#lib/shared/utils"

type HookErrorReporter<TIdentity extends Identity> = GatedConfig<TIdentity>["onHookError"]
type HookPhase = HookErrorReport["phase"]

/**
 * Runs the hook phases of one evaluation against one hook context. No method rejects: a rejecting
 * hook is reported through `onHookError` and the other hooks in its phase still run. Awaitable
 * methods return a promise; detached methods return `void`, so a caller cannot await them or leak
 * their promises.
 */
export type HookRunner = {
  before(): Promise<void>
  /**
   * Runs the after phase, then the finally phase, without blocking the evaluation result.
   */
  dispatchAfterThenFinally(decision: Decision, meta: { source: DecisionSource }): void
  error(error: Error): Promise<void>
  dispatchError(error: Error): void
  dispatchFinally(): void
}

function detach(promise: Promise<void>): void {
  void promise.catch(() => null)
}

export function createHookRunner<TIdentity extends Identity>(
  hooks: ReadonlyArray<Hook<TIdentity>>,
  hookContext: HookContext<TIdentity>,
  reporter?: HookErrorReporter<TIdentity>
): HookRunner {
  async function runPhase(
    phase: HookPhase,
    invoke: (hook: Hook<TIdentity>) => MaybePromise<void> | undefined
  ): Promise<void> {
    const results = await Promise.allSettled(
      hooks.map((hook) => Promise.resolve().then(() => invoke(hook)))
    )
    results.forEach((result, hookIndex) => {
      if (result.status === "rejected") {
        reportInBackground(reporter, {
          context: hookContext,
          error: normalizeError(result.reason),
          hookIndex,
          phase,
        })
      }
    })
  }

  const runError = (error: Error) => runPhase("error", (hook) => hook.error?.(hookContext, error))
  const runFinally = () => runPhase("finally", (hook) => hook.finally?.(hookContext))

  return {
    before: () => runPhase("before", (hook) => hook.before?.(hookContext)),
    dispatchAfterThenFinally(decision, meta) {
      detach(
        runPhase("after", (hook) => hook.after?.(hookContext, decision, meta)).then(runFinally)
      )
    },
    dispatchError(error) {
      detach(runError(error))
    },
    dispatchFinally() {
      detach(runFinally())
    },
    error: runError,
  }
}
