import { GateTimeoutError } from "../errors"
import { normalizeError } from "../utils"

export const noop: () => void = () => null

export function abortReason(signal: AbortSignal): Error {
  return normalizeError(signal.reason)
}

export function createEvaluationSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): { cleanup: () => void; signal: AbortSignal } {
  if (timeoutMs === undefined) {
    const signal = callerSignal ?? new AbortController().signal
    return { cleanup: noop, signal }
  }

  const controller = new AbortController()
  let removeCallerListener = noop

  if (callerSignal) {
    const forwardCallerAbort = () => {
      controller.abort(callerSignal.reason)
    }

    if (callerSignal.aborted) {
      forwardCallerAbort()
    } else {
      callerSignal.addEventListener("abort", forwardCallerAbort, { once: true })
      removeCallerListener = () => {
        callerSignal.removeEventListener("abort", forwardCallerAbort)
      }
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new GateTimeoutError(timeoutMs))
  }, timeoutMs)

  return {
    cleanup() {
      removeCallerListener()
      clearTimeout(timer)
    },
    signal: controller.signal,
  }
}

export async function raceWithSignal<T>(
  operation: () => T | Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw abortReason(signal)
  }

  const aborted = Promise.withResolvers<never>()
  const onAbort = () => {
    aborted.reject(abortReason(signal))
  }
  signal.addEventListener("abort", onAbort, { once: true })
  void aborted.promise.catch(() => null)
  const pending = Promise.resolve().then(operation)
  void pending.catch(() => null)

  try {
    return await Promise.race([pending, aborted.promise])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

export function consumeCleanup(promise: Promise<void>): void {
  void promise.catch(() => null)
}
