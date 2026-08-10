---
"gated": minor
---

Make identity resolution more flexible.

- `identify` can be omitted from `buildGate` when every evaluator and batch call supplies
  `{ identity }`. Caller-identity factories require the identity in their call options.
- Add anonymous allow mode so providers can evaluate a null identity while strict rejection
  remains the default. Anonymous-mode gates also accept `{ identity: null }` to force an
  anonymous evaluation for a single call or batch.
- `GatedConfig` identify and decide functions can return synchronous values; the new
  `MaybePromise` utility type is exported. Normalize their return values with
  `Promise.resolve(...)` before chaining.
- Identity metadata uses the exported `IdentityValue` union instead of an opaque index
  signature.
