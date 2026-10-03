---
"gated": minor
---

A gate factory attaches the configured `subscribe` at most once and sends each change to invalidation and to `factory.changes`. Consumers that count attachments see one attachment instead of two.
