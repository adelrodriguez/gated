import type { Decision } from "./types"

type BooleanDecision = Extract<Decision, { type: "boolean" }>
type VariantDecision<TPayload> = Extract<Decision<TPayload>, { type: "variant" }>

export const decision = {
  boolean(value: boolean): BooleanDecision {
    return { type: "boolean", value }
  },
  variant<TPayload = unknown>(variant: string, payload?: TPayload): VariantDecision<TPayload> {
    return payload === undefined
      ? { type: "variant", variant }
      : { payload, type: "variant", variant }
  },
}
