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

export type GateEvaluator<
  TIdentity extends Identity,
  TValue extends boolean | string,
  TCallIdentity extends TIdentity | null = TIdentity,
  TPayload = unknown,
  TCallRequired extends boolean = false,
> = ((...args: GateCallArguments<TCallIdentity, TCallRequired>) => Promise<TValue>) & {
  details: (
    ...args: GateCallArguments<TCallIdentity, TCallRequired>
  ) => Promise<EvaluationDetails<TValue, TPayload>>
}

export type GateOptions<T extends string[]> = {
  key: string
  defaultValue: boolean | T[number]
  variants?: T
  timeoutMs?: number
}

export type GateConfiguration =
  | { kind: "boolean" }
  | { kind: "variant"; variants: readonly string[] }
