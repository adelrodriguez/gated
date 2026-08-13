import { describe, expect, test } from "bun:test"
import { serializeKey } from "../key"

describe("serializeKey", () => {
  test.each([
    [null, "null"],
    [undefined, "undefined"],
    [false, "boolean:false"],
    [true, "boolean:true"],
    [0, "number:0"],
    [-0, "number:-0"],
    [Number.NaN, "number:NaN"],
    [Number.POSITIVE_INFINITY, "number:Infinity"],
    ["0", 'string:"0"'],
    ['quote: "', 'string:"quote: \\""'],
  ])("encodes %p with its type", (value, expected) => {
    expect(serializeKey(value, "cacheKey")).toBe(expected)
  })

  test("sorts object keys and recursively encodes values", () => {
    const first = {
      enabled: true,
      profile: { plan: "pro", seats: 2 },
    }
    const second = {
      enabled: true,
      profile: { plan: "pro", seats: 2 },
    }

    expect(serializeKey(first, "cacheKey")).toBe(serializeKey(second, "cacheKey"))
    expect(serializeKey(first, "cacheKey")).toBe(
      'object:{"enabled":boolean:true,"profile":object:{"plan":string:"pro","seats":number:2}}'
    )
  })

  test("keeps arrays, objects, and primitive types distinct", () => {
    const keys = [
      serializeKey([0, "0"], "cacheKey"),
      serializeKey({ 0: 0, 1: "0" }, "cacheKey"),
      serializeKey(0, "cacheKey"),
      serializeKey("0", "cacheKey"),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  test("supports plain objects with a null prototype", () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, {
      key: "value",
    })

    expect(serializeKey(value, "cacheKey")).toBe('object:{"key":string:"value"}')
  })

  test("allows a shared object that does not form a cycle", () => {
    const shared = { id: 1 }

    expect(serializeKey([shared, shared], "cacheKey")).toBe(
      'array:[object:{"id":number:1},object:{"id":number:1}]'
    )
  })

  test("rejects sparse arrays at the missing index", () => {
    const value: unknown[] = []
    value.length = 2
    value[1] = "present"

    expect(() => serializeKey({ audience: value }, "cacheKey")).toThrow(
      "Unsupported gate cache key at cacheKey.audience[0]: sparse arrays are not supported."
    )
  })

  test.each([
    [1n, "bigint"],
    [Symbol("key"), "symbol"],
    [() => "value", "function"],
    [new Date(0), "Date"],
    [new Map(), "Map"],
  ])("rejects unsupported %s values", (value, kind) => {
    expect(() => serializeKey(value, "cacheKey")).toThrow(
      `Unsupported gate cache key at cacheKey: ${kind} is not supported.`
    )
  })

  test("reports the path to a nested unsupported value", () => {
    expect(() =>
      serializeKey({ audience: [{ region: "us" }, { region: 1n }] }, "cacheKey")
    ).toThrow("Unsupported gate cache key at cacheKey.audience[1].region: bigint is not supported.")
  })

  test("adds identity guidance for unsupported identity values", () => {
    expect(() => serializeKey({ createdAt: new Date(0) }, "identity")).toThrow(
      "Unsupported gate cache key at identity.createdAt: Date is not supported. Change identify() to return supported cache-key values."
    )
  })

  test("rejects circular references and reports where the cycle closes", () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(() => serializeKey(value, "cacheKey")).toThrow(
      "Unsupported gate cache key at cacheKey.self: circular reference is not supported."
    )
  })
})
