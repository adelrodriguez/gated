import { expect, test } from "bun:test"
import type { BatchEntry as ConcreteBatchEntry } from "../batch"
import type { GateOptions as ConcreteGateOptions } from "../evaluate"
import type { BatchEntry as BarrelBatchEntry, GateOptions as BarrelGateOptions } from "../index"
import * as batch from "../batch"
import * as evaluate from "../evaluate"
import * as hookRunner from "../hook-runner"
import * as barrel from "../index"

function acceptsBarrelBatchEntry(value: BarrelBatchEntry): ConcreteBatchEntry {
  return value
}

function acceptsBarrelGateOptions(
  value: BarrelGateOptions<string[]>
): ConcreteGateOptions<string[]> {
  return value
}

void acceptsBarrelBatchEntry
void acceptsBarrelGateOptions

test("the internal barrel re-exports each concrete engine function", () => {
  expect(barrel.runBeforeHooks).toBe(hookRunner.runBeforeHooks)
  expect(barrel.runResolveHooks).toBe(hookRunner.runResolveHooks)
  expect(barrel.runAfterHooks).toBe(hookRunner.runAfterHooks)
  expect(barrel.runErrorHooks).toBe(hookRunner.runErrorHooks)
  expect(barrel.runFinallyHooks).toBe(hookRunner.runFinallyHooks)
  expect(barrel.identify).toBe(evaluate.identify)
  expect(barrel.extractDecisionValue).toBe(evaluate.extractDecisionValue)
  expect(barrel.validateDecision).toBe(evaluate.validateDecision)
  expect(barrel.executeGateDetails).toBe(evaluate.executeGateDetails)
  expect(barrel.executeGate).toBe(evaluate.executeGate)
  expect(barrel.executeGateBatch).toBe(batch.executeGateBatch)
})
