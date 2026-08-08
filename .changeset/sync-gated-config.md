---
"gated": minor
---

Allow `GatedConfig` identify and decide functions to return synchronous values, matching the existing runtime behavior, and export the new `MaybePromise` utility type.

Code that calls these configuration functions should normalize their return values before chaining promises: use `Promise.resolve(config.identify()).then(...)` instead of `config.identify().then(...)`.
