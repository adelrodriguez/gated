---
"gated": patch
---

`GateBatchIdentityOf` now resolves to the intersection of the gate identity types instead of their union, so `useGateBatch`, `prefetchBatch`, and `invalidateBatch` require an identity that every gate accepts. An empty batch accepts any `Identity`.
