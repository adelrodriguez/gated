---
"gated": minor
---

Add factory and per-gate timeouts plus caller abort signals with observable default
fallbacks.

Export `GateTimeoutError`, add the required `HookContext.signal`, and pass the combined
signal to providers as the third `decide` argument. The provider options object is always
present. Timeout values must be positive finite delays no greater than 2,147,483,647
milliseconds. A deadline reached only while `finally` hooks are pending preserves the
decision already returned.

Consumers that construct `HookContext` objects in tests or custom harnesses must add a
`signal`, such as `new AbortController().signal`.
