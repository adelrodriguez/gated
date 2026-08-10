import { describe, expect, mock, test } from "bun:test"
import type { Decision, Hook, HookContext } from "../types"
import { runAfterHooks, runBeforeHooks, runErrorHooks, runFinallyHooks } from "../hook"

const context: HookContext = {
  defaultValue: false,
  flagKey: "test-flag",
  identity: { distinctId: "user123" },
  kind: "boolean",
  signal: new AbortController().signal,
}

describe("observer hook runners", () => {
  test("runs all before hooks and isolates failures", async () => {
    const failed = mock(() => Promise.reject(new Error("Hook error")))
    const passed = mock(() => Promise.resolve())

    await runBeforeHooks([{ before: failed }, { before: passed }], context)

    expect(failed).toHaveBeenCalledWith(context)
    expect(passed).toHaveBeenCalledWith(context)
  })

  test("runs all after hooks with decision source metadata", async () => {
    const first = mock(() => Promise.resolve())
    const second = mock(() => Promise.resolve())
    const decision: Decision = { type: "boolean", value: true }
    const hooks: Hook[] = [{ after: first }, { after: second }]

    await runAfterHooks(hooks, context, decision, { source: "cache" })

    expect(first).toHaveBeenCalledWith(context, decision, { source: "cache" })
    expect(second).toHaveBeenCalledWith(context, decision, { source: "cache" })
  })

  test("runs all error hooks and isolates failures", async () => {
    const failed = mock(() => Promise.reject(new Error("Hook error")))
    const passed = mock(() => Promise.resolve())
    const error = new Error("Provider error")

    await runErrorHooks([{ error: failed }, { error: passed }], context, error)

    expect(failed).toHaveBeenCalledWith(context, error)
    expect(passed).toHaveBeenCalledWith(context, error)
  })

  test("runs all finally hooks and isolates failures", async () => {
    const failed = mock(() => Promise.reject(new Error("Hook error")))
    const passed = mock(() => Promise.resolve())

    await runFinallyHooks([{ finally: failed }, { finally: passed }], context)

    expect(failed).toHaveBeenCalledWith(context)
    expect(passed).toHaveBeenCalledWith(context)
  })

  test("accepts empty hook lists in every phase", async () => {
    await runBeforeHooks([], context)
    await runAfterHooks([], context, { type: "boolean", value: true }, { source: "provider" })
    await runErrorHooks([], context, new Error("Provider error"))
    await runFinallyHooks([], context)
  })
})
