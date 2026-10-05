import type {
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  EvaluationDetails,
  GateCallOptions,
  GateChanges,
  GateEvaluator,
  GatedConfig,
  Identity,
} from "#lib/types"
import { resolveConfig } from "#lib/config/resolved-config"
import { type BatchEntry, executeGateBatch } from "#lib/evaluation/batch"
import { executeGate, executeGateDetails } from "#lib/evaluation/engine"
import { assertGateOptions, assertTimeoutMs } from "#lib/gate/configuration"
import { type EvaluatorFactoryRef, getEvaluatorRecord, registerEvaluator } from "#lib/gate/registry"
import { ForeignGateEvaluatorError, BatchFlagNotFoundError } from "#lib/shared/errors"
import { reportInBackground } from "#lib/shared/report"

type AnyGateEvaluator =
  | GateEvaluator<never, boolean | string, never>
  | GateEvaluator<never, boolean | string, never, unknown, true>
type GateValue<TEvaluator> =
  TEvaluator extends GateEvaluator<never, infer TValue, never, infer _TPayload, infer _TRequired>
    ? TValue
    : never
type GatePayload<TEvaluator> =
  TEvaluator extends GateEvaluator<never, boolean | string, never, infer TPayload, infer _TRequired>
    ? TPayload
    : never
type GateDetails<TEvaluator> = EvaluationDetails<GateValue<TEvaluator>, GatePayload<TEvaluator>>
type FactoryGateEvaluator<
  TIdentity extends Identity,
  TCallIdentity extends TIdentity | null,
  TCallRequired extends boolean,
> = GateEvaluator<TIdentity, boolean | string, TCallIdentity, unknown, TCallRequired>

export type GateBatch<TFlags extends readonly AnyGateEvaluator[]> = Readonly<{
  [K in keyof TFlags]: GateValue<TFlags[K]>
}> & {
  details<TFlag extends TFlags[number]>(flag: TFlag): GateDetails<TFlag>
  get<TFlag extends TFlags[number]>(flag: TFlag): GateValue<TFlag>
}

export interface GateFactory<
  TIdentity extends Identity,
  TCallIdentity extends TIdentity | null = TIdentity,
  TCallRequired extends boolean = false,
> {
  readonly changes: GateChanges
  (options: {
    key: string
    defaultValue: boolean
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean, TCallIdentity, unknown, TCallRequired>
  <TPayload = unknown, const T extends string[] = string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, T[number], TCallIdentity, TPayload, TCallRequired>
  /**
   * Evaluates several gates from this factory with one identity resolution.
   *
   * TypeScript rejects gates whose identity type does not match this factory. Gates from a
   * different factory with the same identity type pass the type check, and the call throws
   * `ForeignGateEvaluatorError` at runtime.
   */
  batch<
    const TFlags extends ReadonlyArray<
      FactoryGateEvaluator<TIdentity, TCallIdentity, TCallRequired>
    >,
  >(
    flags: TFlags,
    ...args: TCallRequired extends true
      ? [options: GateCallOptions<TCallIdentity> & { identity: Extract<TCallIdentity, Identity> }]
      : [options?: GateCallOptions<TCallIdentity>]
  ): Promise<GateBatch<TFlags>>
}

/**
 * A builder function that creates a gated function to evaluate feature flags for a given identity.
 *
 * @example
 *   const gate = buildGate({
 *     identify: async () => ({ distinctId: getCurrentUserId() }),
 *     decide: async (key, identity) => yourProvider.evaluate(key, identity),
 *   })
 *
 *   const betaAccess = gate({ key: "beta-access", defaultValue: false })
 *
 *   await betaAccess()
 *   await betaAccess({ identity: { distinctId: "test-user" } }) // Evaluate for a specific identity
 *
 *   const theme = gate({
 *     key: "theme",
 *     defaultValue: "light",
 *     variants: ["light", "dark", "system"],
 *   })
 *
 *   const result = await theme() // "light" | "dark" | "system"
 */
export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity>
): GateFactory<TIdentity>
export function buildGate<TIdentity extends Identity>(
  config: AnonymousGatedConfig<TIdentity>
): GateFactory<TIdentity, TIdentity | null>
export function buildGate<TIdentity extends Identity>(
  config: CallerIdentityGatedConfig<TIdentity>
): GateFactory<TIdentity, TIdentity, true>
export function buildGate<TIdentity extends Identity>(
  config:
    | GatedConfig<TIdentity>
    | AnonymousGatedConfig<TIdentity>
    | CallerIdentityGatedConfig<TIdentity>
): GateFactory<TIdentity, TIdentity | null> | GateFactory<TIdentity, TIdentity, true> {
  assertTimeoutMs(config.timeoutMs)
  const resolved = resolveConfig(config)
  const changes: GateChanges = {
    subscribe(listener) {
      return (
        resolved.changes?.subscribe((keys) => {
          reportInBackground(listener, keys)
        }) ?? (() => null)
      )
    },
  }

  async function batch(
    flags: readonly AnyGateEvaluator[],
    callOptions?: GateCallOptions<TIdentity | null>
  ): Promise<GateBatch<readonly AnyGateEvaluator[]>> {
    const entries: BatchEntry[] = flags.map((flag) => {
      const record = getEvaluatorRecord(flag)
      if (!record || record.factoryRef !== factoryRef) {
        throw new ForeignGateEvaluatorError()
      }
      return { flag, options: record.options }
    })
    const results = await executeGateBatch(resolved, entries, callOptions)
    const getDetails = <TFlag extends AnyGateEvaluator>(flag: TFlag): GateDetails<TFlag> => {
      const details = results.get(flag)
      if (!details) {
        throw new BatchFlagNotFoundError()
      }
      return details as GateDetails<TFlag>
    }
    const values = flags.map((flag) => getDetails(flag).value)
    return Object.assign(values, {
      details: getDetails,
      get<TFlag extends AnyGateEvaluator>(flag: TFlag): GateValue<TFlag> {
        return getDetails(flag).value
      },
    })
  }

  const factoryRef: EvaluatorFactoryRef = {
    batch: batch as EvaluatorFactoryRef["batch"],
    changes,
  }

  function gate(options: {
    key: string
    defaultValue: boolean
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean, TIdentity | null>
  function gate<TPayload = unknown, const T extends string[] = string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, T[number], TIdentity | null, TPayload>
  function gate<TPayload = unknown, const T extends string[] = string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean | T[number], TIdentity | null, TPayload> {
    assertGateOptions(options)
    assertTimeoutMs(options.timeoutMs)

    // Read on each call, as the batch does for its entries.
    const deadline = () => ({ timeoutMs: options.timeoutMs ?? resolved.timeoutMs })
    const evaluator = async (callOptions?: GateCallOptions<TIdentity | null>) =>
      executeGate(resolved, options, callOptions, resolved, deadline())

    const assigned = Object.assign(evaluator, {
      details: (callOptions?: GateCallOptions<TIdentity | null>) =>
        executeGateDetails<TIdentity, T, TPayload>(
          resolved,
          options,
          callOptions,
          resolved,
          deadline()
        ),
    })
    registerEvaluator(assigned, { factoryRef, options })
    return assigned
  }

  return Object.assign(gate, {
    batch: batch as <const TFlags extends readonly AnyGateEvaluator[]>(
      flags: TFlags,
      callOptions?: GateCallOptions<TIdentity | null>
    ) => Promise<GateBatch<TFlags>>,
    changes,
  })
}
