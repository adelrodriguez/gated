import type { GateConfiguration } from "#lib/types"

export function getGateConfiguration(variants?: readonly string[]): GateConfiguration {
  return variants ? { kind: "variant", variants } : { kind: "boolean" }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

export function assertTimeoutMs(timeoutMs: number | undefined): void {
  if (
    timeoutMs !== undefined
    && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS)
  ) {
    throw new RangeError(
      `timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`
    )
  }
}

export function assertGateOptions(options: {
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
