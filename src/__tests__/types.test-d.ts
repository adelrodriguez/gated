// Compile-time checks only: `pnpm run check` enforces this file, and Vitest never runs it.
import { expectTypeOf } from "vitest"
import type {
  AnonymousGatedConfig,
  CallerIdentityGatedConfig,
  Decision,
  DecisionSource,
  EvaluationDetails,
  GateBatch,
  GateCallOptions,
  GatedConfig,
  GateEvaluator,
  GateFactory,
  Hook,
  HookContext,
  Identity,
  GatedError,
  InvalidVariantError,
} from "../index"
import type {
  GateBatchIdentityOf,
  GateBatchValuesOf,
  GateDetailsOf,
  GateHooks,
  GateIdentityOf,
  GateValueOf,
  ReactGateCache,
} from "../integrations/react"
import { defineHook as defineHookFromHooks } from "../hooks"
import { buildGate, decision, defineHook } from "../index"
import {
  createGateCache,
  createGateHooks,
  FeatureGate,
  GateProvider,
  useGate,
  useGateBatch,
  useGateCache,
} from "../integrations/react"

// ── Test fixtures ────────────────────────────────────────────────────────────
interface ConsumerIdentity extends Identity {
  plan: "free" | "pro"
}

interface OrganizationIdentity extends Identity {
  organizationId: string
}

type Theme = "light" | "dark"
type ThemePayload = { experiment: string }

const factory = buildGate<ConsumerIdentity>({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer", plan: "pro" }),
})
const anonymousFactory = buildGate<ConsumerIdentity>({
  anonymous: "allow",
  decide: () => decision.boolean(true),
  identify: () => null,
})
const callerFactory = buildGate<ConsumerIdentity>({
  decide: () => decision.boolean(true),
})

const booleanGate = factory({ defaultValue: false, key: "beta" })
const variantGate = factory<ThemePayload, ["light", "dark"]>({
  defaultValue: "light",
  key: "theme",
  variants: ["light", "dark"],
})
const organizationFactory = buildGate<OrganizationIdentity>({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer", organizationId: "org" }),
})
const organizationGate = organizationFactory({ defaultValue: false, key: "beta" })
const wideFactory = buildGate<Identity>({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer" }),
})
const wideGate = wideFactory({ defaultValue: false, key: "beta" })
const anonymousGate = anonymousFactory({ defaultValue: false, key: "beta" })
const callerGate = callerFactory({ defaultValue: false, key: "beta" })

type Flags = readonly [typeof booleanGate, typeof variantGate]

const consumerHooks = createGateHooks(factory)

// ── Positive type-level tests ────────────────────────────────────────────────
// Returns a factory that resolves the configured identity for each call.
{
  expectTypeOf(factory).toEqualTypeOf<GateFactory<ConsumerIdentity>>()
}

// Lets an anonymous factory accept a null caller identity.
{
  expectTypeOf(anonymousFactory).toEqualTypeOf<
    GateFactory<ConsumerIdentity, ConsumerIdentity | null>
  >()
}

// Requires caller identity when the config has no identify function.
{
  expectTypeOf(callerFactory).toEqualTypeOf<GateFactory<ConsumerIdentity, ConsumerIdentity, true>>()
}

// Infers the identity type from identify when no type argument is given.
{
  const inferred = buildGate({
    decide: () => decision.boolean(true),
    identify: () => ({ distinctId: 1, team: "core" }),
  })

  expectTypeOf(inferred).toEqualTypeOf<GateFactory<{ distinctId: number; team: string }>>()
}

// Types the identity passed to decide, decideMany, hooks, and error callbacks.
{
  buildGate<ConsumerIdentity>({
    decide: (key, identity) => {
      expectTypeOf(key).toEqualTypeOf<string>()
      expectTypeOf(identity).toEqualTypeOf<ConsumerIdentity>()
      return decision.boolean(true)
    },
    decideMany: (keys, identity) => {
      expectTypeOf(keys).toEqualTypeOf<readonly string[]>()
      expectTypeOf(identity).toEqualTypeOf<ConsumerIdentity>()
      return {}
    },
    hooks: [
      {
        before: (context) => {
          expectTypeOf(context.identity).toEqualTypeOf<ConsumerIdentity | null>()
        },
      },
    ],
    identify: () => null,
    onCacheError: (report) => {
      expectTypeOf(report.identity).toEqualTypeOf<ConsumerIdentity | null>()
    },
    onHookError: (report) => {
      expectTypeOf(report.phase).toEqualTypeOf<"before" | "after" | "error" | "finally">()
    },
  })

  buildGate<ConsumerIdentity>({
    anonymous: "allow",
    decide: (_key, identity) => {
      expectTypeOf(identity).toEqualTypeOf<ConsumerIdentity | null>()
      return decision.boolean(true)
    },
    identify: () => null,
  })
}

// Exports the three config shapes that buildGate accepts.
{
  expectTypeOf<AnonymousGatedConfig<ConsumerIdentity>["anonymous"]>().toEqualTypeOf<"allow">()
  expectTypeOf<GatedConfig<ConsumerIdentity>["anonymous"]>().toEqualTypeOf<"reject" | undefined>()
  expectTypeOf<CallerIdentityGatedConfig<ConsumerIdentity>["identify"]>().toEqualTypeOf<undefined>()
}

// Types boolean gates as boolean evaluators.
{
  expectTypeOf(booleanGate).toEqualTypeOf<
    GateEvaluator<ConsumerIdentity, boolean, ConsumerIdentity>
  >()
  expectTypeOf(booleanGate).returns.resolves.toEqualTypeOf<boolean>()
  expectTypeOf(booleanGate).parameters.toEqualTypeOf<
    [options?: GateCallOptions<ConsumerIdentity>]
  >()
}

// Keeps the identity marker out of the string keys of a gate.
{
  expectTypeOf<Extract<keyof typeof booleanGate, string>>().toEqualTypeOf<"details">()
}

// Types variant gates with the variant union and payload type.
{
  expectTypeOf(variantGate).toEqualTypeOf<
    GateEvaluator<ConsumerIdentity, Theme, ConsumerIdentity, ThemePayload>
  >()
  expectTypeOf(variantGate).returns.resolves.toEqualTypeOf<Theme>()
}

// Infers the variant union from a variants literal without type arguments.
{
  const gate = factory({
    defaultValue: "light",
    key: "theme",
    variants: ["light", "dark", "system"],
  })

  expectTypeOf<GateValueOf<typeof gate>>().toEqualTypeOf<"light" | "dark" | "system">()
  expectTypeOf<GateDetailsOf<typeof gate>>().toEqualTypeOf<
    EvaluationDetails<"light" | "dark" | "system">
  >()
}

// Accepts a null identity only on anonymous factory gates.
{
  expectTypeOf(anonymousGate).parameters.toEqualTypeOf<
    [options?: GateCallOptions<ConsumerIdentity | null>]
  >()

  void anonymousGate({ identity: null })
}

// Requires an identity on every call from a caller-identity factory.
{
  expectTypeOf(callerGate).parameter(0).toHaveProperty("identity").toEqualTypeOf<ConsumerIdentity>()

  void callerGate({ identity: { distinctId: "consumer", plan: "free" } })
  void callerFactory.batch([callerGate], { identity: { distinctId: "consumer", plan: "free" } })
}

// Types evaluation details for boolean and variant gates.
{
  expectTypeOf(booleanGate.details).returns.resolves.toEqualTypeOf<EvaluationDetails<boolean>>()
  expectTypeOf<GateDetailsOf<typeof variantGate>>().toEqualTypeOf<
    EvaluationDetails<Theme, ThemePayload>
  >()
}

// Exposes a payload only on variant evaluation details.
{
  expectTypeOf<keyof EvaluationDetails<boolean>>().toEqualTypeOf<
    "error" | "flagKey" | "source" | "value"
  >()
  expectTypeOf<EvaluationDetails<Theme, ThemePayload>["payload"]>().toEqualTypeOf<
    ThemePayload | undefined
  >()
}

// Narrows evaluation details to an error only for the default source.
function _narrowDetails(details: EvaluationDetails<Theme>): void {
  if (details.source === "default") {
    expectTypeOf(details.error).toEqualTypeOf<Error>()
  } else {
    expectTypeOf(details.source).toEqualTypeOf<DecisionSource>()
    expectTypeOf(details.error).toEqualTypeOf<undefined>()
  }
}

// Extracts gate value, identity, and details types for React consumers.
{
  expectTypeOf<GateValueOf<typeof booleanGate>>().toEqualTypeOf<boolean>()
  expectTypeOf<GateValueOf<typeof variantGate>>().toEqualTypeOf<Theme>()
  expectTypeOf<GateIdentityOf<typeof booleanGate>>().toEqualTypeOf<ConsumerIdentity>()
  expectTypeOf<GateIdentityOf<typeof anonymousGate>>().toEqualTypeOf<ConsumerIdentity>()
  expectTypeOf<GateIdentityOf<typeof callerGate>>().toEqualTypeOf<ConsumerIdentity>()
  expectTypeOf<GateIdentityOf<typeof wideGate>>().toEqualTypeOf<Identity>()
  expectTypeOf<GateDetailsOf<typeof variantGate>>().toEqualTypeOf<
    EvaluationDetails<Theme, ThemePayload>
  >()
  expectTypeOf<GateBatchValuesOf<Flags>>().toEqualTypeOf<Readonly<[boolean, Theme]>>()
  expectTypeOf<GateBatchIdentityOf<Flags>>().toEqualTypeOf<ConsumerIdentity>()
}

// Types a React batch identity as the intersection of the gate identity types.
{
  expectTypeOf<
    GateBatchIdentityOf<readonly [typeof booleanGate, typeof organizationGate]>
  >().toEqualTypeOf<ConsumerIdentity & OrganizationIdentity>()
  expectTypeOf<
    GateBatchIdentityOf<readonly [typeof organizationGate]>
  >().toEqualTypeOf<OrganizationIdentity>()
  expectTypeOf<
    GateBatchIdentityOf<readonly [typeof booleanGate, typeof anonymousGate]>
  >().toEqualTypeOf<ConsumerIdentity>()
  expectTypeOf<
    GateBatchIdentityOf<Array<typeof booleanGate | typeof organizationGate>>
  >().toEqualTypeOf<ConsumerIdentity & OrganizationIdentity>()
  expectTypeOf<GateBatchIdentityOf<readonly []>>().toEqualTypeOf<Identity>()
}

// Accepts a React batch identity that satisfies every gate identity type.
function MixedIdentityConsumer(): null {
  const batch = useGateBatch([booleanGate, organizationGate], {
    identity: { distinctId: "consumer", organizationId: "org", plan: "pro" },
  })

  expectTypeOf(batch).toEqualTypeOf<Readonly<[boolean, boolean]>>()

  return null
}

// Types batch results as a readonly tuple with typed get and details lookups.
async function _batch(): Promise<void> {
  const batch = await factory.batch([booleanGate, variantGate])

  expectTypeOf(batch).toEqualTypeOf<GateBatch<Flags>>()
  expectTypeOf(batch[0]).toEqualTypeOf<boolean>()
  expectTypeOf(batch[1]).toEqualTypeOf<Theme>()
  expectTypeOf(batch.length).toEqualTypeOf<2>()

  const value = batch.get(variantGate)
  const details = batch.details(variantGate)

  expectTypeOf(value).toEqualTypeOf<Theme>()
  expectTypeOf(details).toEqualTypeOf<EvaluationDetails<Theme, ThemePayload>>()
}

// Types decision helpers as members of the Decision union.
{
  const booleanDecision = decision.boolean(true)
  const variantDecision = decision.variant("dark", { experiment: "a" })
  const untypedVariant = decision.variant("dark")

  expectTypeOf(booleanDecision).toEqualTypeOf<{ type: "boolean"; value: boolean }>()
  expectTypeOf(variantDecision).toEqualTypeOf<{
    type: "variant"
    variant: string
    payload?: ThemePayload
  }>()
  expectTypeOf(untypedVariant).toEqualTypeOf<{
    type: "variant"
    variant: string
    payload?: unknown
  }>()
  expectTypeOf(variantDecision).toExtend<Decision<ThemePayload>>()
}

// Types hook contexts by gate kind.
function _narrowHookContext(context: HookContext<ConsumerIdentity>): void {
  if (context.kind === "variant") {
    expectTypeOf(context.defaultValue).toEqualTypeOf<string>()
    expectTypeOf(context.variants).toEqualTypeOf<readonly string[]>()
  } else {
    expectTypeOf(context.defaultValue).toEqualTypeOf<boolean>()
    expectTypeOf(context.variants).toEqualTypeOf<undefined>()
  }
}

// Types defineHook objects and factories from the root and hooks entrypoints.
{
  const hook = defineHook<ConsumerIdentity>({
    after: (context, result, meta) => {
      expectTypeOf(context.identity).toEqualTypeOf<ConsumerIdentity | null>()
      expectTypeOf(result).toEqualTypeOf<Decision>()
      expectTypeOf(meta.source).toEqualTypeOf<DecisionSource>()
    },
  })
  const required = defineHook((options: { prefix: string }) => ({
    before: () => {
      void options.prefix
    },
  }))
  const optional = defineHookFromHooks((options?: { prefix: string }) => ({
    before: () => {
      void options?.prefix
    },
  }))

  expectTypeOf(hook).toEqualTypeOf<Hook<ConsumerIdentity>>()
  expectTypeOf(required).toEqualTypeOf<(options: { prefix: string }) => Hook>()
  expectTypeOf(optional).toEqualTypeOf<(options?: { prefix: string }) => Hook>()
  expectTypeOf(defineHook).toEqualTypeOf(defineHookFromHooks)
}

// Exports error classes that extend GatedError.
{
  expectTypeOf<InvalidVariantError>().toExtend<GatedError>()
  expectTypeOf<InvalidVariantError["allowedVariants"]>().toEqualTypeOf<readonly string[]>()
}

// Types the React hooks from the gate type.
function Consumer(): null {
  const value = useGate(booleanGate)
  const details = useGate(booleanGate, { details: true })
  const variant = useGate(variantGate, { identity: { distinctId: "consumer", plan: "pro" } })
  const batch = useGateBatch([booleanGate, variantGate])
  const custom = useGate(() => Promise.resolve(1), { key: ["custom", 1] })
  const cache = useGateCache()

  expectTypeOf(value).toEqualTypeOf<boolean>()
  expectTypeOf(details).toEqualTypeOf<EvaluationDetails<boolean>>()
  expectTypeOf(variant).toEqualTypeOf<Theme>()
  expectTypeOf(batch).toEqualTypeOf<Readonly<[boolean, Theme]>>()
  expectTypeOf(custom).toEqualTypeOf<number>()
  expectTypeOf(cache).toEqualTypeOf<ReactGateCache>()

  return null
}

// Types the React cache and components.
{
  const cache = createGateCache({ maxEntries: 10, ttlMs: 1000 })

  expectTypeOf(cache).toEqualTypeOf<ReactGateCache>()

  void cache.prefetch(variantGate, { identity: { distinctId: "consumer", plan: "pro" } })
  void cache.prefetchBatch([booleanGate, variantGate], { ttlMs: 1000 })
  cache.invalidate(booleanGate, { distinctId: "consumer", plan: "free" })
  cache.invalidateKey(["custom", 1])

  void GateProvider({ cache, children: null, identity: { distinctId: "consumer" } })
  void FeatureGate({ children: null, gate: booleanGate })
  void FeatureGate({ children: null, gate: variantGate, match: "dark" })
}

// Types the hooks from createGateHooks to the factory identity type and call mode.
{
  expectTypeOf(consumerHooks).toEqualTypeOf<GateHooks<ConsumerIdentity>>()
  expectTypeOf(createGateHooks(anonymousFactory)).toEqualTypeOf<
    GateHooks<ConsumerIdentity, ConsumerIdentity | null>
  >()
  expectTypeOf(createGateHooks(callerFactory)).toEqualTypeOf<
    GateHooks<ConsumerIdentity, ConsumerIdentity, true>
  >()

  void consumerHooks.GateProvider({
    children: null,
    identity: { distinctId: "consumer", plan: "pro" },
  })
}

function BoundConsumer(): null {
  const value = consumerHooks.useGate(booleanGate)
  const details = consumerHooks.useGate(variantGate, { details: true })
  const batch = consumerHooks.useGateBatch([booleanGate, variantGate])

  expectTypeOf(value).toEqualTypeOf<boolean>()
  expectTypeOf(details).toEqualTypeOf<EvaluationDetails<Theme, ThemePayload>>()
  expectTypeOf(batch).toEqualTypeOf<Readonly<[boolean, Theme]>>()

  return null
}

// ── Negative type tests ──────────────────────────────────────────────────────
// These verify that invalid usage produces compile-time errors.
// The function bodies never execute — only the type checker matters.

function _negativeTypeTests(): void {
  // @ts-expect-error -- defaultValue must be one of the declared variants
  factory({ defaultValue: "blue", key: "theme", variants: ["light", "dark"] })

  // @ts-expect-error -- a string defaultValue requires variants
  factory({ defaultValue: "light", key: "theme" })

  // @ts-expect-error -- a variant gate requires a string defaultValue
  factory({ defaultValue: false, key: "theme", variants: ["light", "dark"] })

  buildGate<ConsumerIdentity>({
    decide: () => decision.boolean(true),
    // @ts-expect-error -- identify must return the full identity shape
    identify: () => ({ distinctId: "consumer" }),
  })

  buildGate<ConsumerIdentity>({
    // @ts-expect-error -- decide must return a valid decision
    decide: () => ({ type: "boolean", value: "yes" }),
  })

  buildGate({
    decide: () => decision.boolean(true),
    // @ts-expect-error -- distinctId must be a string or a number
    identify: () => ({ distinctId: true }),
  })

  buildGate<ConsumerIdentity>({
    decide: () => decision.boolean(true),
    // @ts-expect-error -- hooks must accept the factory identity
    hooks: [defineHook<{ distinctId: string; org: string }>({})],
  })

  // @ts-expect-error -- plan must be "free" or "pro"
  void booleanGate({ identity: { distinctId: "consumer", plan: "enterprise" } })

  // @ts-expect-error -- the identity must include plan
  void booleanGate({ identity: { distinctId: "consumer" } })

  // @ts-expect-error -- only anonymous factories accept a null identity
  void booleanGate({ identity: null })

  // @ts-expect-error -- caller-identity factories require an identity
  void callerGate()

  // @ts-expect-error -- caller-identity batches require an identity
  void callerFactory.batch([callerGate])

  // @ts-expect-error -- batch flags must match the factory identity type
  void factory.batch([booleanGate, organizationGate])

  // @ts-expect-error -- batch flags must not have a wider identity type than the factory
  void factory.batch([wideGate])

  // @ts-expect-error -- a non-anonymous gate does not accept the null identity of an anonymous batch
  void anonymousFactory.batch([booleanGate])

  // @ts-expect-error -- an anonymous gate does not belong to a non-anonymous factory
  void factory.batch([anonymousGate])

  // @ts-expect-error -- a caller-identity gate does not belong to a factory with identify
  void factory.batch([callerGate])

  void callerFactory.batch(
    // @ts-expect-error -- a gate from a factory with identify does not belong to a caller-identity factory
    [booleanGate],
    { identity: { distinctId: "consumer", plan: "free" } }
  )

  void callerFactory.batch(
    // @ts-expect-error -- an anonymous gate does not belong to a caller-identity factory
    [anonymousGate],
    { identity: { distinctId: "consumer", plan: "free" } }
  )

  // @ts-expect-error -- a caller-identity gate does not belong to an anonymous factory
  void anonymousFactory.batch([callerGate])

  // @ts-expect-error -- decision.variant requires a variant name
  decision.variant()

  // @ts-expect-error -- match must be one of the gate variants
  void FeatureGate({ children: null, gate: variantGate, match: "blue" })

  // @ts-expect-error -- a variant gate requires match
  void FeatureGate({ children: null, gate: variantGate })

  // @ts-expect-error -- the hook factory requires its options
  defineHook((options: { prefix: string }) => ({ before: () => void options.prefix }))()
}

async function _negativeBatchTypeTests(): Promise<void> {
  const batch = await factory.batch([booleanGate])

  // @ts-expect-error -- the batch does not contain this gate
  batch.get(variantGate)

  // @ts-expect-error -- batch values are readonly
  batch[0] = true
}

function useInvalidBoundForms(): void {
  void consumerHooks.GateProvider({
    children: null,
    // @ts-expect-error -- the provider identity must include plan
    identity: { distinctId: "consumer" },
  })
  // @ts-expect-error -- the hooks accept only gates with the factory identity type
  consumerHooks.useGate(organizationGate)
  // @ts-expect-error -- the hooks accept only gates with the factory call mode
  consumerHooks.useGate(anonymousGate)
  // @ts-expect-error -- every batch gate must have the factory identity type
  consumerHooks.useGateBatch([booleanGate, wideGate])
  // @ts-expect-error -- the hook identity must include plan
  consumerHooks.useGate(booleanGate, { identity: { distinctId: "consumer" } })
}

function useInvalidForms(): void {
  // @ts-expect-error -- The function form requires a key.
  useGate(() => Promise.resolve(1))
  // @ts-expect-error -- The function form does not support evaluation details.
  useGate(() => Promise.resolve(1), { details: true, key: "custom" })
  // @ts-expect-error -- the identity must match the gate identity
  useGate(booleanGate, { identity: { distinctId: "consumer", plan: "enterprise" } })
  useGateBatch([booleanGate, organizationGate], {
    // @ts-expect-error -- the batch identity must satisfy every gate identity type
    identity: { distinctId: "consumer", plan: "pro" },
  })
}

// Suppress unused function warnings — these exist only for type checking.
void _batch
void BoundConsumer
void Consumer
void MixedIdentityConsumer
void _narrowDetails
void _narrowHookContext
void _negativeTypeTests
void _negativeBatchTypeTests
void useInvalidBoundForms
void useInvalidForms
