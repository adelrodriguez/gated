# Domain docs

This repository uses a single-context domain-doc layout.

## Before you explore

Read these files:

- `CONTEXT.md` at the repository root.
- This domain vocabulary.

## Vocabulary

Use these terms consistently in code, tests, issues, and documentation.

| Term                    | Meaning                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **gate factory**        | The callable object returned from `buildGate`. It creates evaluators and owns `batch()`; batches accept only evaluators from that same factory.                                                                          |
| **gate / evaluator**    | An async callable created by a gate factory and configured with a key, default value, optional variants, and optional timeout. It also exposes `details()`.                                                              |
| **decision**            | A provider or cached result with an explicit `type` discriminant: either `{ type: "boolean", value: boolean }` or `{ type: "variant", variant: string, payload?: IdentityValue }`.                                       |
| **boolean decision**    | A `type: "boolean"` decision that evaluates a boolean gate.                                                                                                                                                              |
| **variant decision**    | A `type: "variant"` decision that evaluates a gate with configured string variants. Its variant must be allowed; optional payload is available through evaluation details.                                               |
| **evaluation details**  | A result containing the returned value, flag key, and source (`cache`, `provider`, or `default`), plus a variant payload or fallback error when present.                                                                 |
| **identity**            | The provider-specific subject used for evaluation. It extends `Identity`, which requires `distinctId`. Resolution is strict unless the factory opts into anonymous evaluation, where hooks/providers may receive `null`. |
| **hook**                | A lifecycle observer with optional `before`, `after`, `error`, and `finally` handlers. `after` receives decision-source metadata.                                                                                        |
| **evaluation key**      | The collision-safe string that cache and request coalescing use to identify one flag and identity evaluation. It includes the gate shape and typed `distinctId` by default and can use a consumer projection.            |
| **cache**               | Built-in behavior that reads a decision before provider work and writes provider-leader decisions after commit. The store owns serialization and expiry.                                                                 |
| **request coalescing**  | Built-in behavior that lets concurrent evaluations with one flag, compatible gate shape, and identity share provider work after cache reads. Each evaluation keeps its own error, fallback, and cancellation path.       |
| **batch**               | The synchronously readable, destructurable tuple of evaluating several gates together after one identity resolution and optional provider-level `decideMany` call. React reaches it through `useGateBatch`.              |
| **gate cache**          | The bounded React promise cache created by `createGateCache`. It owns invalidation, clearing, and prefetch operations.                                                                                                   |
| **gate provider**       | The React provider that isolates a gate cache per mount and can supply a default identity to descendant gate hooks.                                                                                                      |
| **integration**         | An optional framework-facing package surface built on the core API, such as the React integration.                                                                                                                       |
| **package consumer**    | An application or library that installs Gated and imports its published package entry points.                                                                                                                            |
| **public entry points** | The supported import paths: `gated`, `gated/hooks`, and `gated/react`.                                                                                                                                                   |

Avoid calling a decision a "flag value" when distinguishing the provider result from the gate's returned value matters.
