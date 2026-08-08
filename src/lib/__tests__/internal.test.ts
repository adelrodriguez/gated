import { describe, expect, test } from "bun:test"
import { DedupeOwnerFinalizationError, HookResolutionAbortError } from "../internal"

describe("internal hook control errors", () => {
  test("identifies the unsettled dedupe key", () => {
    const error = new DedupeOwnerFinalizationError("beta-access:user123")

    expect(error.key).toBe("beta-access:user123")
    expect(error.message).toContain("beta-access:user123")
  })

  test("retains the underlying hook resolution failure", () => {
    const cause = new Error("Provider failed")
    const error = new HookResolutionAbortError(cause)

    expect(error.originalError).toBe(cause)
    expect(error.cause).toBe(cause)
  })
})
