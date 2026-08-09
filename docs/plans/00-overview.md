# Plan Series Overview

Source: [2026-08-06-codebase-review.md](2026-08-06-codebase-review.md). Each plan is a vertical slice: implementation + tests + docs (README/CONTEXT/domain.md as applicable) + changeset. Execute in order unless the dependency notes say otherwise.

| #   | Plan                                      | Fixes / Delivers                      | Depends on        | Breaking?                                                             |
| --- | ----------------------------------------- | ------------------------------------- | ----------------- | --------------------------------------------------------------------- |
| 01  | Fix doc drift, export missing types       | H7, H8, `Gate`/evaluator type exports | —                 | No                                                                    |
| 02  | Unify config types, accept sync functions | H9                                    | —                 | No                                                                    |
| 03  | Uniform lifecycle + evaluation record     | H1, H4, arch #1/#2/#5                 | 02                | Behavioral (pre-1.0 ok)                                               |
| 04  | Hook error policy                         | H5, arch #3                           | 03                | Behavioral                                                            |
| 05  | React integration rework                  | H2, H3, H10, arch #4                  | — (coordinate 08) | Yes (FeatureGate semantics and `createReactHook` → `createReactGate`) |
| 06  | Enrich HookContext                        | API #2                                | 03                | Yes (drops `TOptions`)                                                |
| 07  | Evaluation details API                    | H6, API #1                            | 03                | No (additive)                                                         |
| 08  | Evaluator options object                  | API #3                                | 07                | Yes (call signature)                                                  |
| 09  | Timeout + abort support                   | API #4                                | 03, 04, 06-08     | Yes (required `HookContext.signal`)                                   |
| 10  | Decision discriminant + variant payloads  | API #5                                | 03, 06, 07        | Yes (Decision shape)                                                  |
| 11  | Anonymous identity support                | API #6                                | 03, 06, 07        | Behavioral                                                            |
| 12  | Batch evaluation                          | API #7                                | 03, 08, 09, 11    | No (additive)                                                         |
| 13  | Define hook authoring                     | Class-free hook definitions           | 04, 06, 09, 10    | Yes (removes createHook)                                              |
| 14  | Test & docs hardening                     | Testing #1-#5                         | all prior         | No                                                                    |

Notes:

- 01 and 02 are quick wins; land immediately.
- 03 is the keystone: it introduces the internal evaluation record and the "after hooks always run" contract that 04, 06, 07, 10, 11, 12 build on.
- 05 is independent of core changes and urgent (React integration currently unusable with real async gates); it can be done in parallel with 03-04, but its evaluator and identity-facing API must be coordinated with 08.
- 13 replaces `createHook` with the single preferred hook-authoring interface after the hook context, decision, signal, and error contracts have stabilized.
- Breaking changes are acceptable pre-1.0 but each needs a changeset with a clear migration note. Consider batching 06, 08, 10 into one minor release to avoid churn.
