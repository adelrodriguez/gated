---
"gated": minor
---

Gate evaluators now take an options object, and `FeatureGate` now names its identity prop `identity`.

Migrate evaluator calls from `await flag({ distinctId })` to `await flag({ identity: { distinctId } })`, and migrate React usage from `<FeatureGate overrideIdentity={identity} />` to `<FeatureGate identity={identity} />`. `GateEvaluator` identity types are constrained to `Identity`. `createReactGate(gatedEvaluator)` remains configuration-free, while custom async functions must now provide a semantic cache projection, for example `createReactGate(customAsyncGate, { cacheKey: (accountId) => accountId })`.
