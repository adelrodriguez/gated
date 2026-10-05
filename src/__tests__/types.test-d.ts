// Compile-time checks only: `pnpm run check` enforces this file, and Vitest never runs it.
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
  GateIdentityOf,
  GateValueOf,
  ReactGateCache,
} from "../integrations/react"
import { defineHook as defineHookFromHooks } from "../hooks"
import { buildGate, decision, defineHook } from "../index"
import {
  createGateCache,
  FeatureGate,
  GateProvider,
  useGate,
  useGateBatch,
  useGateCache,
} from "../integrations/react"

// ── Helpers ──────────────────────────────────────────────────────────────────
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Expect<T extends true> = T

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
const anonymousGate = anonymousFactory({ defaultValue: false, key: "beta" })
const callerGate = callerFactory({ defaultValue: false, key: "beta" })

type Flags = readonly [typeof booleanGate, typeof variantGate]

// ── Positive type-level tests ────────────────────────────────────────────────
// Returns a factory that resolves the configured identity for each call.
{
  type _Factory = Expect<Equal<typeof factory, GateFactory<ConsumerIdentity>>>
}

// Lets an anonymous factory accept a null caller identity.
{
  type _Factory = Expect<
    Equal<typeof anonymousFactory, GateFactory<ConsumerIdentity, ConsumerIdentity | null>>
  >
}

// Requires caller identity when the config has no identify function.
{
  type _Factory = Expect<
    Equal<typeof callerFactory, GateFactory<ConsumerIdentity, ConsumerIdentity, true>>
  >
}

// Infers the identity type from identify when no type argument is given.
{
  const inferred = buildGate({
    decide: () => decision.boolean(true),
    identify: () => ({ distinctId: 1, team: "core" }),
  })

  type _Factory = Expect<Equal<typeof inferred, GateFactory<{ distinctId: number; team: string }>>>
}

// Types the identity passed to decide, decideMany, hooks, and error callbacks.
{
  buildGate<ConsumerIdentity>({
    decide: (key, identity) => {
      type _Key = Expect<Equal<typeof key, string>>
      type _Identity = Expect<Equal<typeof identity, ConsumerIdentity>>
      return decision.boolean(true)
    },
    decideMany: (keys, identity) => {
      type _Keys = Expect<Equal<typeof keys, readonly string[]>>
      type _Identity = Expect<Equal<typeof identity, ConsumerIdentity>>
      return {}
    },
    hooks: [
      {
        before: (context) => {
          type _Identity = Expect<Equal<typeof context.identity, ConsumerIdentity | null>>
        },
      },
    ],
    identify: () => null,
    onCacheError: (report) => {
      type _Identity = Expect<Equal<typeof report.identity, ConsumerIdentity | null>>
    },
    onHookError: (report) => {
      type _Phase = Expect<Equal<typeof report.phase, "before" | "after" | "error" | "finally">>
    },
  })

  buildGate<ConsumerIdentity>({
    anonymous: "allow",
    decide: (_key, identity) => {
      type _Identity = Expect<Equal<typeof identity, ConsumerIdentity | null>>
      return decision.boolean(true)
    },
    identify: () => null,
  })
}

// Exports the three config shapes that buildGate accepts.
{
  type _Anonymous = Expect<Equal<AnonymousGatedConfig<ConsumerIdentity>["anonymous"], "allow">>
  type _Default = Expect<Equal<GatedConfig<ConsumerIdentity>["anonymous"], "reject" | undefined>>
  type _CallerIdentity = Expect<
    Equal<CallerIdentityGatedConfig<ConsumerIdentity>["identify"], undefined>
  >
}

// Types boolean gates as boolean evaluators.
{
  type _Gate = Expect<
    Equal<typeof booleanGate, GateEvaluator<ConsumerIdentity, boolean, ConsumerIdentity>>
  >
  type _Value = Expect<Equal<Awaited<ReturnType<typeof booleanGate>>, boolean>>
  type _Options = Expect<
    Equal<Parameters<typeof booleanGate>, [options?: GateCallOptions<ConsumerIdentity>]>
  >
}

// Types variant gates with the variant union and payload type.
{
  type _Gate = Expect<
    Equal<
      typeof variantGate,
      GateEvaluator<ConsumerIdentity, Theme, ConsumerIdentity, ThemePayload>
    >
  >
  type _Value = Expect<Equal<Awaited<ReturnType<typeof variantGate>>, Theme>>
}

// Infers the variant union from a variants literal without type arguments.
{
  const gate = factory({
    defaultValue: "light",
    key: "theme",
    variants: ["light", "dark", "system"],
  })

  type _Value = Expect<Equal<GateValueOf<typeof gate>, "light" | "dark" | "system">>
  type _Payload = Expect<
    Equal<GateDetailsOf<typeof gate>, EvaluationDetails<"light" | "dark" | "system">>
  >
}

// Accepts a null identity only on anonymous factory gates.
{
  type _Options = Expect<
    Equal<Parameters<typeof anonymousGate>, [options?: GateCallOptions<ConsumerIdentity | null>]>
  >

  void anonymousGate({ identity: null })
}

// Requires an identity on every call from a caller-identity factory.
{
  type _Identity = Expect<Equal<Parameters<typeof callerGate>[0]["identity"], ConsumerIdentity>>

  void callerGate({ identity: { distinctId: "consumer", plan: "free" } })
  void callerFactory.batch([callerGate], { identity: { distinctId: "consumer", plan: "free" } })
}

// Types evaluation details for boolean and variant gates.
{
  type _Boolean = Expect<
    Equal<Awaited<ReturnType<typeof booleanGate.details>>, EvaluationDetails<boolean>>
  >
  type _Variant = Expect<
    Equal<GateDetailsOf<typeof variantGate>, EvaluationDetails<Theme, ThemePayload>>
  >
}

// Exposes a payload only on variant evaluation details.
{
  type _BooleanKeys = Expect<
    Equal<keyof EvaluationDetails<boolean>, "error" | "flagKey" | "source" | "value">
  >
  type _VariantPayload = Expect<
    Equal<EvaluationDetails<Theme, ThemePayload>["payload"], ThemePayload | undefined>
  >
}

// Narrows evaluation details to an error only for the default source.
function _narrowDetails(details: EvaluationDetails<Theme>): void {
  if (details.source === "default") {
    type _Error = Expect<Equal<typeof details.error, Error>>
  } else {
    type _Source = Expect<Equal<typeof details.source, DecisionSource>>
    type _Error = Expect<Equal<typeof details.error, undefined>>
  }
}

// Extracts gate value, identity, and details types for React consumers.
{
  type _BooleanValue = Expect<Equal<GateValueOf<typeof booleanGate>, boolean>>
  type _VariantValue = Expect<Equal<GateValueOf<typeof variantGate>, Theme>>
  type _Identity = Expect<Equal<GateIdentityOf<typeof booleanGate>, ConsumerIdentity>>
  type _AnonymousIdentity = Expect<Equal<GateIdentityOf<typeof anonymousGate>, ConsumerIdentity>>
  type _CallerIdentity = Expect<Equal<GateIdentityOf<typeof callerGate>, ConsumerIdentity>>
  type _Details = Expect<
    Equal<GateDetailsOf<typeof variantGate>, EvaluationDetails<Theme, ThemePayload>>
  >
  type _BatchValues = Expect<Equal<GateBatchValuesOf<Flags>, Readonly<[boolean, Theme]>>>
  type _BatchIdentity = Expect<Equal<GateBatchIdentityOf<Flags>, ConsumerIdentity>>
}

// Types a React batch identity as the intersection of the gate identity types.
{
  type _Mixed = Expect<
    Equal<
      GateBatchIdentityOf<readonly [typeof booleanGate, typeof organizationGate]>,
      ConsumerIdentity & OrganizationIdentity
    >
  >
  type _Single = Expect<
    Equal<GateBatchIdentityOf<readonly [typeof organizationGate]>, OrganizationIdentity>
  >
  type _Anonymous = Expect<
    Equal<
      GateBatchIdentityOf<readonly [typeof booleanGate, typeof anonymousGate]>,
      ConsumerIdentity
    >
  >
  type _Array = Expect<
    Equal<
      GateBatchIdentityOf<Array<typeof booleanGate | typeof organizationGate>>,
      ConsumerIdentity & OrganizationIdentity
    >
  >
  type _Empty = Expect<Equal<GateBatchIdentityOf<readonly []>, Identity>>
}

// Accepts a React batch identity that satisfies every gate identity type.
function MixedIdentityConsumer(): null {
  const batch = useGateBatch([booleanGate, organizationGate], {
    identity: { distinctId: "consumer", organizationId: "org", plan: "pro" },
  })

  type _Batch = Expect<Equal<typeof batch, Readonly<[boolean, boolean]>>>

  return null
}

// Types batch results as a readonly tuple with typed get and details lookups.
async function _batch(): Promise<void> {
  const batch = await factory.batch([booleanGate, variantGate])

  type _Batch = Expect<Equal<typeof batch, GateBatch<Flags>>>
  type _First = Expect<Equal<(typeof batch)[0], boolean>>
  type _Second = Expect<Equal<(typeof batch)[1], Theme>>
  type _Length = Expect<Equal<(typeof batch)["length"], 2>>

  const value = batch.get(variantGate)
  const details = batch.details(variantGate)

  type _Get = Expect<Equal<typeof value, Theme>>
  type _Details = Expect<Equal<typeof details, EvaluationDetails<Theme, ThemePayload>>>
}

// Types decision helpers as members of the Decision union.
{
  const booleanDecision = decision.boolean(true)
  const variantDecision = decision.variant("dark", { experiment: "a" })
  const untypedVariant = decision.variant("dark")

  type _Boolean = Expect<Equal<typeof booleanDecision, { type: "boolean"; value: boolean }>>
  type _Variant = Expect<
    Equal<typeof variantDecision, { type: "variant"; variant: string; payload?: ThemePayload }>
  >
  type _Untyped = Expect<
    Equal<typeof untypedVariant, { type: "variant"; variant: string; payload?: unknown }>
  >
  type _IsDecision = Expect<typeof variantDecision extends Decision<ThemePayload> ? true : false>
}

// Types hook contexts by gate kind.
function _narrowHookContext(context: HookContext<ConsumerIdentity>): void {
  if (context.kind === "variant") {
    type _Default = Expect<Equal<typeof context.defaultValue, string>>
    type _Variants = Expect<Equal<typeof context.variants, readonly string[]>>
  } else {
    type _Default = Expect<Equal<typeof context.defaultValue, boolean>>
    type _Variants = Expect<Equal<typeof context.variants, undefined>>
  }
}

// Types defineHook objects and factories from the root and hooks entrypoints.
{
  const hook = defineHook<ConsumerIdentity>({
    after: (context, result, meta) => {
      type _Identity = Expect<Equal<typeof context.identity, ConsumerIdentity | null>>
      type _Decision = Expect<Equal<typeof result, Decision>>
      type _Source = Expect<Equal<typeof meta.source, DecisionSource>>
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

  type _Hook = Expect<Equal<typeof hook, Hook<ConsumerIdentity>>>
  type _Required = Expect<Equal<typeof required, (options: { prefix: string }) => Hook>>
  type _Optional = Expect<Equal<typeof optional, (options?: { prefix: string }) => Hook>>
  type _SameExport = Expect<Equal<typeof defineHook, typeof defineHookFromHooks>>
}

// Exports error classes that extend GatedError.
{
  type _InvalidVariant = Expect<InvalidVariantError extends GatedError ? true : false>
  type _AllowedVariants = Expect<Equal<InvalidVariantError["allowedVariants"], readonly string[]>>
}

// Types the React hooks from the gate type.
function Consumer(): null {
  const value = useGate(booleanGate)
  const details = useGate(booleanGate, { details: true })
  const variant = useGate(variantGate, { identity: { distinctId: "consumer", plan: "pro" } })
  const batch = useGateBatch([booleanGate, variantGate])
  const custom = useGate(() => Promise.resolve(1), { key: ["custom", 1] })
  const cache = useGateCache()

  type _Value = Expect<Equal<typeof value, boolean>>
  type _Details = Expect<Equal<typeof details, EvaluationDetails<boolean>>>
  type _Variant = Expect<Equal<typeof variant, Theme>>
  type _Batch = Expect<Equal<typeof batch, Readonly<[boolean, Theme]>>>
  type _Custom = Expect<Equal<typeof custom, number>>
  type _Cache = Expect<Equal<typeof cache, ReactGateCache>>

  return null
}

// Types the React cache and components.
{
  const cache = createGateCache({ maxEntries: 10, ttlMs: 1000 })

  type _Cache = Expect<Equal<typeof cache, ReactGateCache>>

  void cache.prefetch(variantGate, { identity: { distinctId: "consumer", plan: "pro" } })
  void cache.prefetchBatch([booleanGate, variantGate], { ttlMs: 1000 })
  cache.invalidate(booleanGate, { distinctId: "consumer", plan: "free" })
  cache.invalidateKey(["custom", 1])

  void GateProvider({ cache, children: null, identity: { distinctId: "consumer" } })
  void FeatureGate({ children: null, gate: booleanGate })
  void FeatureGate({ children: null, gate: variantGate, match: "dark" })
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

  // @ts-expect-error -- a non-anonymous gate does not accept the null identity of an anonymous batch
  void anonymousFactory.batch([booleanGate])

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
void Consumer
void MixedIdentityConsumer
void _narrowDetails
void _narrowHookContext
void _negativeTypeTests
void _negativeBatchTypeTests
void useInvalidForms
