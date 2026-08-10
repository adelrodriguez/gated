import { describe, expect, spyOn, test } from "bun:test"
import { createGateCache } from "../index"

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: Error) => void
  resolve: (value: T) => void
} {
  let rejectPromise!: (error: Error) => void
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

describe("createGateCache", () => {
  test("evicts an expired pending entry but pins a fresh pending entry", () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const cache = createGateCache({ maxEntries: 1, pendingTtlMs: 100 })
    const expired = deferred<boolean>()
    const fresh = deferred<boolean>()

    cache.set("expired", expired.promise)
    now = 101
    cache.set("fresh", fresh.promise)

    expect(cache.get("expired")).toBeUndefined()
    expect(cache.get("fresh")).toBe(fresh.promise)
    dateNow.mockRestore()
  })

  test("keeps fresh pending entries pinned under LRU pressure", () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const cache = createGateCache({ maxEntries: 1, pendingTtlMs: 100 })
    const first = deferred<boolean>()
    const second = deferred<boolean>()

    cache.set("first", first.promise)
    now = 50
    cache.set("second", second.promise)

    expect(cache.get("first")).toBe(first.promise)
    expect(cache.get("second")).toBe(second.promise)
    dateNow.mockRestore()
  })

  test("does not let an evicted pending evaluation overwrite a newer entry", async () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const cache = createGateCache({ pendingTtlMs: 100 })
    const expired = deferred<boolean>()
    const replacement = deferred<boolean>()

    cache.set("flag", expired.promise)
    now = 101
    expect(cache.get("flag")).toBeUndefined()
    cache.set("flag", replacement.promise)

    expired.resolve(true)
    await expired.promise
    await Bun.sleep(0)

    expect(cache.get("flag")).toBe(replacement.promise)
    dateNow.mockRestore()
  })

  test("uses least-recently-used eviction after evaluations settle", async () => {
    const cache = createGateCache({ maxEntries: 2, ttlMs: 1000 })
    const first = Promise.resolve(true)
    const second = Promise.resolve(false)
    const third = Promise.resolve(true)

    cache.set("first", first)
    cache.set("second", second)
    await Promise.all([first, second])
    await Bun.sleep(0)
    expect(cache.get("first")).toBe(first)
    cache.set("third", third)
    await third
    await Bun.sleep(0)

    expect(cache.get("second")).toBeUndefined()
    expect(cache.get("first")).toBe(first)
    expect(cache.get("third")).toBe(third)
  })

  test("starts TTL expiry when an evaluation settles", async () => {
    let now = 0
    const dateNow = spyOn(Date, "now").mockImplementation(() => now)
    const cache = createGateCache({ ttlMs: 100 })
    const evaluation = deferred<boolean>()
    cache.set("flag", evaluation.promise)

    now = 101
    expect(cache.get("flag")).toBe(evaluation.promise)

    evaluation.resolve(true)
    await evaluation.promise
    now = 202

    expect(cache.get("flag")).toBeUndefined()
    dateNow.mockRestore()
  })

  test("does not evict unsettled evaluations under LRU pressure", () => {
    const cache = createGateCache({ maxEntries: 1 })
    const first = deferred<boolean>()
    const second = deferred<boolean>()

    cache.set("first", first.promise)
    cache.set("second", second.promise)

    expect(cache.get("first")).toBe(first.promise)
    expect(cache.get("second")).toBe(second.promise)
  })

  test("rejects invalid bounds", () => {
    expect(() => createGateCache({ maxEntries: 0 })).toThrow(RangeError)
    expect(() => createGateCache({ maxEntries: 1.5 })).toThrow(RangeError)
    expect(() => createGateCache({ pendingTtlMs: 0 })).toThrow(RangeError)
    expect(() => createGateCache({ ttlMs: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})
