---
"gated": minor
---

Replace opaque API types with explicit value and error contracts.

Hook failures are now normalized to `Error` before reaching `error` hooks or `onHookError`. Identity metadata uses the exported `IdentityValue` union instead of an opaque index signature.
