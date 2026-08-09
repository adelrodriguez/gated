import type {
  AnonymousGatedConfig,
  EvaluationDetails,
  GateCallOptions,
  GateEvaluator,
  GatedConfig,
  Identity,
} from "./lib/types"
import {
  executeGate,
  executeGateDetails,
  executeGateBatch,
  type GateOptions,
  type BatchEntry,
} from "./lib"
import { ForeignGateEvaluatorError, BatchFlagNotFoundError } from "./lib/errors"

type AnyGateEvaluator = GateEvaluator<never, boolean | string>
type GateValue<TEvaluator> = TEvaluator extends GateEvaluator<never, infer TValue> ? TValue : never
type GateDetails<TEvaluator> = EvaluationDetails<GateValue<TEvaluator>>

export type GateBatch<TFlags extends readonly AnyGateEvaluator[]> = {
  details<TFlag extends TFlags[number]>(flag: TFlag): GateDetails<TFlag>
  get<TFlag extends TFlags[number]>(flag: TFlag): GateValue<TFlag>
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

function assertTimeoutMs(timeoutMs: number | undefined): void {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS)
  ) {
    throw new RangeError(
      `timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`
    )
  }
}

function assertCallOptions(callOptions: unknown): void {
  if (
    callOptions !== null &&
    typeof callOptions === "object" &&
    Object.hasOwn(callOptions, "distinctId") &&
    !Object.hasOwn(callOptions, "identity")
  ) {
    throw new TypeError(
      "Gate evaluators now accept an options object; pass the identity as { identity }."
    )
  }
}

export interface GateFactory<TIdentity extends Identity> {
  (options: {
    key: string
    defaultValue: boolean
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean>
  <const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, T[number]>
  batch<const TFlags extends readonly AnyGateEvaluator[]>(
    flags: TFlags,
    options?: GateCallOptions<TIdentity>
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
  // oxlint-disable-next-line typescript/unified-signatures -- Overloads preserve anonymous-mode contextual typing.
  config: AnonymousGatedConfig<TIdentity>
): GateFactory<TIdentity>
export function buildGate<TIdentity extends Identity>(
  config: GatedConfig<TIdentity> | AnonymousGatedConfig<TIdentity>
): GateFactory<TIdentity> {
  assertTimeoutMs(config.timeoutMs)
  const definitions = new WeakMap<object, GateOptions<string[]>>()

  function gate(options: {
    key: string
    defaultValue: boolean
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: T[number]
    variants: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, T[number]>
  function gate<const T extends string[]>(options: {
    key: string
    defaultValue: boolean | T[number]
    variants?: T
    timeoutMs?: number
  }): GateEvaluator<TIdentity, boolean | T[number]> {
    assertTimeoutMs(options.timeoutMs)

    const evaluator = async (callOptions?: GateCallOptions<TIdentity>) => {
      assertCallOptions(callOptions)
      return executeGate(config, options, callOptions)
    }

    const assigned = Object.assign(evaluator, {
      details: async (callOptions?: GateCallOptions<TIdentity>) => {
        assertCallOptions(callOptions)
        return executeGateDetails(config, options, callOptions)
      },
    })
    definitions.set(assigned, options)
    return assigned
  }

  return Object.assign(gate, {
    async batch<const TFlags extends readonly AnyGateEvaluator[]>(
      flags: TFlags,
      callOptions?: GateCallOptions<TIdentity>
    ): Promise<GateBatch<TFlags>> {
      assertCallOptions(callOptions)
      const entries: BatchEntry[] = flags.map((flag) => {
        const options = definitions.get(flag)
        if (!options) {
          throw new ForeignGateEvaluatorError()
        }
        return { flag, options }
      })
      const results = await executeGateBatch(config, entries, callOptions)
      const getDetails = <TFlag extends TFlags[number]>(flag: TFlag): GateDetails<TFlag> => {
        const details = results.get(flag)
        if (!details) {
          throw new BatchFlagNotFoundError()
        }
        return details as GateDetails<TFlag>
      }
      return {
        details: getDetails,
        get<TFlag extends TFlags[number]>(flag: TFlag): GateValue<TFlag> {
          return getDetails(flag).value
        },
      }
    },
  })
}
