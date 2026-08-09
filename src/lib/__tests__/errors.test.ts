import { describe, expect, test } from "bun:test"
import {
  DecisionTypeMismatchError,
  GatedError,
  IdentityNotFoundError,
  InvalidVariantError,
  MalformedDecisionError,
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
})
