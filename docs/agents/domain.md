# Gated Domain Vocabulary

Use these terms consistently in code, tests, issues, and documentation.

| Term                    | Meaning                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gate**                | An async evaluator created by the factory returned from `buildGate`. It is configured with a key, default value, and optionally variants.                                  |
| **decision**            | A provider or resolving hook result: either `{ type: "boolean", value: boolean }` or `{ type: "variant", variant: string, payload? }`.                                     |
| **boolean decision**    | A decision with `type: "boolean"` and a boolean `value` that evaluates a boolean gate.                                                                                     |
| **variant decision**    | A decision with `type: "variant"` and a `variant` that evaluates a gate with configured string variants. It may carry an optional provider `payload`.                      |
| **identity**            | The provider-specific subject used for evaluation. It extends `Identity`, which requires `distinctId`.                                                                     |
| **hook**                | A lifecycle extension with optional `before`, `resolve`, `after`, `error`, and `finally` handlers. A `resolve` handler can supply a decision without calling the provider. |
| **integration**         | An optional framework-facing package surface built on the core API, such as the React integration.                                                                         |
| **package consumer**    | An application or library that installs Gated and imports its published package entry points.                                                                              |
| **public entry points** | The supported import paths: `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react`.                                                                              |

Avoid calling a decision a "flag value" when distinguishing the provider result from the gate's returned value matters.
