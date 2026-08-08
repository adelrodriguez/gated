---
"gated": minor
---

Add `onHookError` to `GatedConfig` so ordinary hook failures in every lifecycle phase are reported instead of silently swallowed. Internal hook-resolution aborts remain gate-level control flow and are not reported as hook failures. Export contextual `GatedError` subclasses for missing identities, decision mismatches, and invalid variants while keeping hook-control errors internal.
