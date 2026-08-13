export type GateCacheKey =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly GateCacheKey[]
  | { readonly [key: string]: GateCacheKey }

/**
 * Encodes a cache-key value into a stable, collision-free string. Object keys are sorted so
 * insertion order does not affect the encoding, and every value is type-prefixed so distinct
 * primitives (for example 0 and "0") never collide. Values outside GateCacheKey throw instead of
 * silently coercing into an unstable or colliding key.
 */
export function serializeKey(value: unknown, rootPath: "cacheKey" | "identity"): string {
  const ancestors = new Set<object>()

  const identityRemedy =
    rootPath === "identity" ? " Change identify() to return supported cache-key values." : ""

  function encode(current: unknown, path: string): string {
    if (current === null) {
      return "null"
    }

    switch (typeof current) {
      case "undefined":
        return "undefined"
      case "boolean":
        return `boolean:${current}`
      case "number":
        return `number:${Object.is(current, -0) ? "-0" : String(current)}`
      case "string":
        return `string:${JSON.stringify(current)}`
      case "object": {
        const prototype = Object.getPrototypeOf(current)
        if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
          const constructor = (prototype as { constructor?: unknown }).constructor
          const kind =
            typeof constructor === "function" && constructor.name
              ? constructor.name
              : "non-plain object"
          throw new TypeError(
            `Unsupported gate cache key at ${path}: ${kind} is not supported.${identityRemedy}`
          )
        }

        if (ancestors.has(current)) {
          throw new TypeError(
            `Unsupported gate cache key at ${path}: circular reference is not supported.${identityRemedy}`
          )
        }

        ancestors.add(current)
        try {
          if (Array.isArray(current)) {
            for (let index = 0; index < current.length; index += 1) {
              if (!Object.hasOwn(current, index)) {
                throw new TypeError(
                  `Unsupported gate cache key at ${path}[${index}]: sparse arrays are not supported.${identityRemedy}`
                )
              }
            }
            return `array:[${current
              .map((item, index) => encode(item, `${path}[${index}]`))
              .join(",")}]`
          }

          const keys = Object.keys(current)

          keys.sort()
          const entries = keys.map(
            (key) =>
              `${JSON.stringify(key)}:${encode(
                (current as Record<string, unknown>)[key],
                `${path}.${key}`
              )}`
          )
          return `object:{${entries.join(",")}}`
        } finally {
          ancestors.delete(current)
        }
      }
      default:
        throw new TypeError(
          `Unsupported gate cache key at ${path}: ${typeof current} is not supported.${identityRemedy}`
        )
    }
  }

  return encode(value, rootPath)
}
