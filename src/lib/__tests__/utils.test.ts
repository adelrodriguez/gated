import { describe, expect, test } from "bun:test"
import { normalizeError } from "../utils"

describe("normalizeError", () => {
  test("serializes a thrown non-Error object", () => {
    expect(normalizeError({ code: "unavailable" }).message).toBe('{"code":"unavailable"}')
  })

  test("uses the object fallback when serialization fails", () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(normalizeError(circular).message).toBe("Non-Error object thrown")
  })

  test("uses a stable message for a thrown function", () => {
    expect(normalizeError(() => null).message).toBe("Non-Error function thrown")
  })
})
