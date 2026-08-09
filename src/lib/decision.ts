import type { Decision, IdentityValue } from "./types"

type BooleanDecision = Extract<Decision, { type: "boolean" }>
type VariantDecision = Extract<Decision, { type: "variant" }>

export const decision = {
  boolean(value: boolean): BooleanDecision {
    return { type: "boolean", value }
  },
  variant(variant: string, payload?: IdentityValue): VariantDecision {
    return payload === undefined
      ? { type: "variant", variant }
      : { payload, type: "variant", variant }
  },
}
