import type { Decision } from "../types"
import { DecisionTypeMismatchError, InvalidVariantError, MalformedDecisionError } from "../errors"
import { type GateOptions, getGateConfiguration } from "./shared"

export function extractDecisionValue(decision: Decision) {
  return decision.type === "variant" ? decision.variant : decision.value
}

export function validateDecision<T extends string[]>(
  decision: unknown,
  options: GateOptions<T>
): asserts decision is Decision {
  if (typeof decision !== "object" || decision === null) {
    throw new MalformedDecisionError(decision, "expected an object")
  }

  const type = Reflect.get(decision, "type")

  if (type !== "boolean" && type !== "variant") {
    throw new MalformedDecisionError(decision, 'type must be "boolean" or "variant"')
  }

  if (type === "boolean" && typeof Reflect.get(decision, "value") !== "boolean") {
    throw new MalformedDecisionError(decision, "boolean value must be a boolean")
  }

  if (type === "variant" && typeof Reflect.get(decision, "variant") !== "string") {
    throw new MalformedDecisionError(decision, "variant must be a string")
  }

  const validDecision = decision as Decision
  const isVariant = validDecision.type === "variant"
  const config = getGateConfiguration(options.variants)

  if (config.kind === "variant" && !isVariant) {
    throw new DecisionTypeMismatchError("variant", validDecision)
  }

  if (config.kind === "boolean" && isVariant) {
    throw new DecisionTypeMismatchError("boolean", validDecision)
  }

  if (!isVariant || config.kind === "boolean") {
    return
  }

  if (!config.variants.includes(validDecision.variant)) {
    throw new InvalidVariantError(validDecision.variant, config.variants)
  }
}
