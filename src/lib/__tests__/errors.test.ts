import { describe, expect, test } from "vitest"
import {
  DecisionTypeMismatchError,
  DuplicateBatchKeyError,
  ForeignGateEvaluatorError,
  GatedError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
  BatchFlagNotFoundError,
} from "../errors"

describe("contextual errors", () => {
  test("names missing identity failures", () => {
    const error = new IdentityNotFoundError()

    expect(error).toBeInstanceOf(GatedError)
    expect(error.name).toBe("IdentityNotFoundError")
    expect(error.message).toBe("Identity not found")
  })

  test("describes decision kind mismatches", () => {
    const decision = { type: "variant", variant: "dark" } as const
    const error = new DecisionTypeMismatchError("boolean", decision)

    expect(error).toMatchObject({
      decision,
      expected: "boolean",
      received: "variant",
    })
  })

  test("retains invalid variant context", () => {
    const error = new InvalidVariantError("purple", ["light", "dark"])

    expect(error.variant).toBe("purple")
    expect(error.allowedVariants).toEqual(["light", "dark"])
  })

  test("retains malformed decision context", () => {
    const decision = { value: "true" }
    const error = new MalformedDecisionError(decision, 'type must be "boolean" or "variant"')

    expect(error).toBeInstanceOf(GatedError)
    expect(error).toMatchObject({
      decision,
      name: "MalformedDecisionError",
      reason: 'type must be "boolean" or "variant"',
    })
  })

  test("describes batch misuse with discriminable errors", () => {
    const duplicate = new DuplicateBatchKeyError("theme")

    expect(duplicate).toBeInstanceOf(GatedError)
    expect(duplicate).toMatchObject({
      key: "theme",
      message: "Batch requires unique flag keys; duplicate: theme",
      name: "DuplicateBatchKeyError",
    })
    expect(new ForeignGateEvaluatorError()).toMatchObject({
      message: "Batch flags must be created by this gate factory",
      name: "ForeignGateEvaluatorError",
    })
    expect(new BatchFlagNotFoundError()).toMatchObject({
      message: "Flag is not part of this batch",
      name: "BatchFlagNotFoundError",
    })
  })
})
