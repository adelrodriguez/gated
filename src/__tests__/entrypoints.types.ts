import type { EvaluationDetails, GateBatch, Identity } from "../index"
import type {
  GateBatchIdentityOf,
  GateBatchValuesOf,
  GateDetailsOf,
  GateIdentityOf,
  GateValueOf,
  ReactGateCache,
} from "../integrations/react"
import { buildGate, decision } from "../index"
import {
  createGateCache,
  FeatureGate,
  GateProvider,
  useGate,
  useGateBatch,
  useGateCache,
} from "../integrations/react"

interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

const factory = buildGate<ConsumerIdentity>({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer", plan: "pro" }),
})
const booleanGate = factory({ defaultValue: false, key: "beta" })
const variantGate = factory<{ experiment: string }, ["light", "dark"]>({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})

type BooleanValue = GateValueOf<typeof booleanGate>
type VariantValue = GateValueOf<typeof variantGate>
type GateIdentity = GateIdentityOf<typeof booleanGate>
type VariantDetails = GateDetailsOf<typeof variantGate>
type BatchValues = GateBatchValuesOf<readonly [typeof booleanGate, typeof variantGate]>
type BatchIdentity = GateBatchIdentityOf<readonly [typeof booleanGate, typeof variantGate]>

const booleanValue: BooleanValue = true
const variantValue: VariantValue = "dark"
const gateIdentity: GateIdentity = { distinctId: "consumer", plan: "pro" }
const batchIdentity: BatchIdentity = gateIdentity
declare const details: VariantDetails
const publicDetails: EvaluationDetails<"light" | "dark", { experiment: string }> = details
const values: BatchValues = [true, "light"]
const cache: ReactGateCache = createGateCache()

async function assertBatch(): Promise<void> {
  const batch: GateBatch<readonly [typeof booleanGate, typeof variantGate]> = await factory.batch([
    booleanGate,
    variantGate,
  ])
  const first: boolean = batch[0]
  const second: "light" | "dark" = batch[1]
  void first
  void second
}

function Consumer(): null {
  const value: boolean = useGate(booleanGate)
  const gateDetails: EvaluationDetails<boolean> = useGate(booleanGate, { details: true })
  const batch: readonly [boolean, "light" | "dark"] = useGateBatch([booleanGate, variantGate])
  const custom: number = useGate(() => Promise.resolve(1), { key: ["custom", 1] })
  void value
  void gateDetails
  void batch
  void custom
  return null
}

function useInvalidForms(): void {
  // @ts-expect-error -- The function form requires a key.
  useGate(() => Promise.resolve(1))
  // @ts-expect-error -- The function form does not support evaluation details.
  useGate(() => Promise.resolve(1), { details: true, key: "custom" })
}

void assertBatch
void batchIdentity
void booleanValue
void cache
void Consumer
void FeatureGate
void GateProvider
void gateIdentity
void publicDetails
void useGateCache
void useInvalidForms
void values
void variantValue
