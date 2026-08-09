import type { Decision } from "./types"

export class GatedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GatedError"
  }
}

export class IdentityNotFoundError extends GatedError {
  constructor() {
    super("Identity not found")
    this.name = "IdentityNotFoundError"
  }
}

export class DecisionTypeMismatchError extends GatedError {
  readonly decision: Decision
  readonly expected: "boolean" | "variant"
  readonly received: "boolean" | "variant"

  constructor(expected: "boolean" | "variant", decision: Decision) {
    let received: "boolean" | "variant"
    let value: boolean | string

    if ("variant" in decision) {
      received = "variant"
      value = decision.variant
    } else {
      received = "boolean"
      value = decision.value
    }

    super(`Type mismatch: expected ${expected} decision but received ${received} "${value}"`)
    this.name = "DecisionTypeMismatchError"
    this.decision = decision
    this.expected = expected
    this.received = received
  }
}

export class MalformedDecisionError extends GatedError {
  readonly decision: unknown
  readonly reason: string

  constructor(decision: unknown, reason: string) {
    super(`Malformed decision: ${reason}`)
    this.name = "MalformedDecisionError"
    this.decision = decision
    this.reason = reason
  }
}

export class InvalidVariantError extends GatedError {
  readonly allowedVariants: readonly string[]
  readonly variant: string

  constructor(variant: string, allowedVariants: readonly string[]) {
    super(`Invalid variant: ${variant}`)
    this.name = "InvalidVariantError"
    this.allowedVariants = [...allowedVariants]
    this.variant = variant
  }
}

export class GateTimeoutError extends GatedError {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Gate evaluation timed out after ${timeoutMs}ms`)
    this.name = "GateTimeoutError"
    this.timeoutMs = timeoutMs
  }
}
