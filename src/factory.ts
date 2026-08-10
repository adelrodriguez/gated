import type {
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  EvaluationDetails,
  GateCallOptions,
  GateChanges,
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
import { setEvaluatorFlagKey } from "./lib/evaluator"
import { reportInBackground } from "./lib/hook-runner"

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

function assertGateOptions(options: {
  key: string
  defaultValue: boolean | string
  variants?: string[]
}): void {
  if (typeof options.key !== "string") {
    throw new TypeError(`key must be a string; received ${String(options.key)}`)
  }
  if (options.key.length === 0) {
    throw new RangeError('key must be a non-empty string; received ""')
  }

  if (options.variants === undefined) {
    if (typeof options.defaultValue !== "boolean") {
      throw new TypeError(
        `defaultValue must be a boolean when variants is absent; received ${String(options.defaultValue)}`
      )
    }
    return
  }

  if (!Array.isArray(options.variants)) {
    throw new TypeError(`variants must be an array; received ${String(options.variants)}`)
  }
  if (options.variants.length === 0) {
    throw new RangeError("variants must be a non-empty array; received []")
  }

  for (const variant of options.variants) {
    if (typeof variant !== "string") {
      throw new TypeError(`variants must contain only strings; received ${String(variant)}`)
    }
  }

  const duplicateVariant = options.variants.find(
    (variant, index, variants) => variants.indexOf(variant) !== index
  )
  if (duplicateVariant !== undefined) {
    throw new RangeError(`variants must be unique; duplicate value: ${duplicateVariant}`)
  }
  if (!options.variants.includes(options.defaultValue as string)) {
    throw new RangeError(
      `defaultValue must be a member of variants; received ${String(options.defaultValue)}`
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
  batch<const TFlags extends readonly AnyGateEvaluator[]>(
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
  // oxlint-disable-next-line typescript/unified-signatures -- Overloads preserve anonymous-mode contextual typing.
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
  const definitions = new WeakMap<object, GateOptions<string[]>>()
  const changeListeners = new Set<(keys?: readonly string[]) => void>()
  let detachProvider: (() => void) | undefined
  const changes: GateChanges = {
    subscribe(listener) {
      changeListeners.add(listener)
      if (changeListeners.size === 1 && config.subscribe) {
        detachProvider = config.subscribe(({ keys }) => {
          for (const changeListener of changeListeners) {
            reportInBackground(changeListener, keys)
          }
        })
      }

      let attached = true
      return () => {
        if (!attached) {
          return
        }
        attached = false
        changeListeners.delete(listener)
        if (changeListeners.size === 0) {
          detachProvider?.()
          detachProvider = undefined
        }
      }
    },
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

    const evaluator = async (callOptions?: GateCallOptions<TIdentity | null>) => {
      assertCallOptions(callOptions)
      return executeGate(config, options, callOptions)
    }

    const assigned = Object.assign(evaluator, {
      details: async (callOptions?: GateCallOptions<TIdentity | null>) => {
        assertCallOptions(callOptions)
        return executeGateDetails<TIdentity, T, TPayload>(config, options, callOptions)
      },
    })
    definitions.set(assigned, options)
    setEvaluatorFlagKey(assigned, options.key)
    return assigned
  }

  return Object.assign(gate, {
    async batch<const TFlags extends readonly AnyGateEvaluator[]>(
      flags: TFlags,
      callOptions?: GateCallOptions<TIdentity | null>
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
    changes,
  })
}
