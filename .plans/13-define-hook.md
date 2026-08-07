# 13 — Define hook authoring

Delivers: a class-free, contextually typed hook-authoring interface. Depends on: 04 (hook error contract), 06 (final context shape), 09 (signal), 10 (final decision shape). Additive with a deprecation; no immediate break.

## Goal

Consumers can define a hook as an object without writing a class or repeating an explicit `Hook<TIdentity>` annotation. Configured and stateful hooks use an ordinary factory whose closure is isolated per invocation. `defineHook` replaces the shallowly named `createHook` while preserving a migration path to 1.0.

## Interface

Support two forms at the same seam:

```ts
export function defineHook<TIdentity extends Identity = Identity>(
  hook: Hook<TIdentity>
): Hook<TIdentity>

export function defineHook<TOptions, TIdentity extends Identity = Identity>(
  factory: (options: TOptions) => Hook<TIdentity>
): (options: TOptions) => Hook<TIdentity>
```

The implementation returns the supplied object or factory unchanged. Its value is contextual typing and one consistent authoring vocabulary; lifecycle execution, validation, error isolation, and ordering remain behind the gate evaluation module rather than being duplicated here.

### Direct hook

```ts
type UserIdentity = Identity & { plan: "free" | "pro" }

const analyticsHook = defineHook<UserIdentity>({
  before(context) {
    analytics.started(context.flagKey, context.identity)
  },
  after(context, decision, metadata) {
    analytics.completed(context.flagKey, decision, metadata.source)
  },
})

const gate = buildGate({
  identify,
  decide,
  hooks: [analyticsHook],
})
```

### Configured or stateful hook

```ts
type AuditOptions = {
  sink: AuditSink
}

const auditHook = defineHook((options: AuditOptions) => {
  let evaluations = 0

  return {
    before() {
      evaluations += 1
    },
    finally(context) {
      options.sink.record(context.flagKey, evaluations)
    },
  }
})

hooks: [auditHook({ sink })]
```

Each factory invocation owns fresh closure state. A direct hook object is shared wherever that object is registered; documentation should recommend the factory form whenever mutable state must be isolated per gate configuration.

## Migration

- Export `defineHook` from both `gated` and `gated/hooks`.
- Keep `createHook` as a deprecated alias of `defineHook` through the remaining 0.x releases so existing consumers do not break immediately.
- Update first-party recipes and documentation to use `defineHook`.
- Remove `createHook` at 1.0 or in a separately planned breaking release; do not maintain two implementations.

```ts
// Before
const loggingHook = createHook(() => ({ before() {} }))
hooks: [loggingHook()]

// Direct definition
const loggingHook = defineHook({ before() {} })
hooks: [loggingHook]

// Factory definition when isolated state or options are needed
const loggingHook = defineHook((options: LoggingOptions) => ({
  before(context) {
    options.logger.info(context.flagKey)
  },
}))
hooks: [loggingHook({ logger })]
```

## Changes

- `src/hooks/index.ts` — add the direct-object and factory overloads for `defineHook`; implement `createHook` as a deprecated alias with the same callable type.
- `src/index.ts` — export `defineHook` alongside the deprecated alias.
- `src/hooks/recipes.ts` — migrate `cacheHook` and `dedupeHook` to `defineHook`; keep their closure state and public call shapes unchanged.
- README/JSDoc — use direct definitions for stateless hooks and factory definitions for configured/stateful hooks; document shared-object versus per-factory-invocation state.

## Tests

- Direct definition receives contextual types for the final `HookContext`, `Decision`, after-hook metadata, and custom identity.
- Direct definition returns the same hook object and works end-to-end when passed to `buildGate` without an extra invocation.
- Factory definition infers its options and produces a hook accepted by `buildGate`.
- Two factory invocations have isolated mutable state.
- Partial lifecycle definitions remain valid.
- `createHook` remains type-compatible and runtime-compatible as a deprecated alias.
- Do not restore the old suite of per-method identity/`typeof`/function-name assertions; test the authoring interface through real gate behavior.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`
- Inspect the built declarations for both overloads and the `createHook` deprecation annotation.

## Release

- Changeset: minor. "Add `defineHook` for class-free direct and factory hook definitions. `createHook` remains as a deprecated alias and will be removed at 1.0."
