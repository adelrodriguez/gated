---
"gated": minor
---

Gates expose `details()` with the evaluated value, source, flag key, and fallback error.

Call `flag.details(overrideIdentity?)` to receive the same typed value as a plain evaluation alongside its `hook`, `provider`, or `default` source. Failed evaluations include the underlying `error` while retaining the existing never-reject fallback behavior.
