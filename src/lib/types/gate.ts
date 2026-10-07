import type { EvaluationDetails } from "./decision"
import type { Identity } from "./identity"

export type GateCallOptions<TIdentity extends Identity | null> = {
  identity?: TIdentity
  signal?: AbortSignal
}

type RequiredGateCallOptions<TIdentity extends Identity> = Omit<
  GateCallOptions<TIdentity>,
  "identity"
> & {
  identity: TIdentity
}

type GateCallArguments<
  TCallIdentity extends Identity | null,
  TCallRequired extends boolean,
> = TCallRequired extends true
  ? [options: RequiredGateCallOptions<Extract<TCallIdentity, Identity>>]
  : [options?: GateCallOptions<TCallIdentity>]

declare const gateIdentity: unique symbol

// Invariant in every factory type argument, so a gate is assignable only where its factory's
// identity type and call mode match exactly.
type GateIdentityMarker<
  TIdentity extends Identity,
  TCallIdentity extends TIdentity | null,
  TCallRequired extends boolean,
> = (marker: [TIdentity, TCallIdentity, TCallRequired]) => [TIdentity, TCallIdentity, TCallRequired]

type GateEvaluatorShape<
  TValue extends boolean | string,
  TCallIdentity extends Identity | null,
  TPayload,
  TCallRequired extends boolean,
> = ((...args: GateCallArguments<TCallIdentity, TCallRequired>) => Promise<TValue>) & {
  details: (
    ...args: GateCallArguments<TCallIdentity, TCallRequired>
  ) => Promise<EvaluationDetails<TValue, TPayload>>
}

export type GateEvaluator<
  TIdentity extends Identity,
  TValue extends boolean | string,
  TCallIdentity extends TIdentity | null = TIdentity,
  TPayload = unknown,
  TCallRequired extends boolean = false,
> = GateEvaluatorShape<TValue, TCallIdentity, TPayload, TCallRequired> & {
  /**
   * Type-only. Evaluators do not have this property at runtime.
   */
  readonly [gateIdentity]: GateIdentityMarker<TIdentity, TCallIdentity, TCallRequired>
}

/**
 * Any evaluator, whatever its identity type and call mode.
 */
export type AnyGateEvaluator =
  | GateEvaluatorShape<boolean | string, never, unknown, false>
  | GateEvaluatorShape<boolean | string, never, unknown, true>

export type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
  timeoutMs?: number
}

export type GateConfiguration =
  | { kind: "boolean" }
  | { kind: "variant"; variants: readonly string[] }
