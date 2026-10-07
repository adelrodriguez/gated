---
"gated": minor
---

Add `createGateHooks(factory)` to `gated/react`. It returns a `GateProvider`, `useGate`, and `useGateBatch` that TypeScript checks against the identity type of the factory, so the provider rejects an incomplete identity. The hooks read the identity only from their own provider.
