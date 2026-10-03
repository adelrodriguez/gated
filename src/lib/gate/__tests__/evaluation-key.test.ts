import { describe, expect, test, vi } from "vitest"
import type { HookContext } from "#lib/types"
import { getEvaluationKey } from "#lib/gate/evaluation-key"

const signal = new AbortController().signal

const booleanContext: HookContext = {
  defaultValue: false,
  flagKey: "beta-access",
  identity: { distinctId: "user-1" },
  kind: "boolean",
  signal,
}

const variantContext: HookContext = {
  defaultValue: "light",
  flagKey: "theme",
  identity: { distinctId: 42 },
  kind: "variant",
  signal,
  variants: ["light", "dark"],
}

describe("getEvaluationKey", () => {
  test("encodes the flag key, gate shape, and typed distinctId by default", () => {
    expect(getEvaluationKey(booleanContext)).toBe(
      JSON.stringify(["beta-access", "boolean", undefined, "string", "user-1"])
    )
    expect(getEvaluationKey(variantContext)).toBe(
      JSON.stringify(["theme", "variant", ["light", "dark"], "number", "42"])
    )
  })

  test("keeps a numeric and a string distinctId with one text apart", () => {
    const numeric = getEvaluationKey({ ...booleanContext, identity: { distinctId: 7 } })
    const text = getEvaluationKey({ ...booleanContext, identity: { distinctId: "7" } })

    expect(numeric).not.toBe(text)
  })

  test("returns undefined for an anonymous identity", () => {
    const evaluationKey = vi.fn(() => "custom")

    expect(getEvaluationKey({ ...booleanContext, identity: null })).toBeUndefined()
    expect(getEvaluationKey({ ...booleanContext, identity: null }, evaluationKey)).toBeUndefined()
    expect(evaluationKey).not.toHaveBeenCalled()
  })

  test("uses a custom evaluationKey projection", () => {
    const evaluationKey = vi.fn((context: HookContext) => `custom:${context.flagKey}`)

    expect(getEvaluationKey(booleanContext, evaluationKey)).toBe("custom:beta-access")
    expect(evaluationKey).toHaveBeenCalledWith(booleanContext)
  })
})
