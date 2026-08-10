import { describe, expect, spyOn, test } from "bun:test"
import { createEvaluationSignal } from "../signals"

describe("createEvaluationSignal", () => {
  test("forwards an already-aborted caller signal when a timeout is configured", () => {
    const caller = new AbortController()
    const reason = new Error("caller stopped")
    caller.abort(reason)

    const evaluation = createEvaluationSignal(caller.signal, 100)

    expect(evaluation.signal.aborted).toBe(true)
    expect(evaluation.signal.reason).toBe(reason)
    evaluation.cleanup()
  })

  test("removes the caller abort listener during cleanup", () => {
    const caller = new AbortController()
    const removeEventListener = spyOn(caller.signal, "removeEventListener")
    const evaluation = createEvaluationSignal(caller.signal, 100)

    evaluation.cleanup()
    caller.abort(new Error("too late"))

    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(evaluation.signal.aborted).toBe(false)
  })
})
