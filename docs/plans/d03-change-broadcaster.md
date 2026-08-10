# d03 — One broadcaster for provider change signals

Status: **exploration** — the friction is confirmed, but the attach-lifetime semantics need a decision before implementation; see the open questions. From the 2026-08-10 architecture review (revised 2026-08-14 — the count dropped from three attachments to two after #83/#84 rebuilt cache invalidation, and the remaining two now have _different_ lifetimes, which sharpens the problem). Depends on: —. Behavioral change: the consumer's `config.subscribe` is attached at most once per factory instead of up to twice; attach/detach timing shifts (see open questions).

## Goal

The gate factory attaches `config.subscribe` at most once and fans change notifications out to every internal and external listener. One attach implementation, one documented lifetime.

## Problem

Two independent attachments to the same provider signal, with different lifetimes:

1. `factory.changes` (src/factory.ts:168-193) — ref-counted: attaches `config.subscribe` on the first `changes.subscribe` listener, detaches on the last, with an `attached` idempotence flag per unsubscribe closure. The React integration subscribes through this (react.tsx:450).
2. Invalidation (src/lib/evaluation/resolve.ts:111-169, `attachInvalidationSubscription`) — attach-once-permanent: attaches on the first evaluation that touches cache or coalescing and is intentionally never detached (the provider's detach function is not retained).

Consequences:

- A config using both `changes` and a cache gets its `subscribe` called **twice**, with two notify callbacks and two contradictory lifetimes (one ref-counted, one permanent). The `subscribe` contract in `types.ts` says nothing about multiple attachment.
- A consumer counting attachments (or paying per subscription) observes an undocumented second attach whose timing depends on cache configuration and evaluation order.

## Design sketch

```ts
// owned by the factory, created in buildGate
type ChangeBroadcaster = {
  subscribe(listener: (keys?: readonly string[]) => void): () => void
}
```

- Created once in `buildGate`, closing over `config.subscribe`. Attaches the provider on the first listener, and — per open question 1 — either detaches on the last or stays attached for the factory's lifetime.
- `factory.changes` becomes a thin delegation (keeping its `reportInBackground` dispatch).
- `attachInvalidationSubscription` becomes a broadcaster subscription; the invalidation _logic_ (drop pending, bump write generation, delete indexed entries) stays in resolve.ts.

## Open questions (must close before implementation)

1. **One lifetime.** The invalidation subscription is deliberately permanent (see the comment at resolve.ts:31-33); `factory.changes` is deliberately ref-counted. A single broadcaster must pick one: permanent-once-attached (simpler; matches invalidation's correctness argument) or ref-counted-with-invalidation-counted-as-a-listener (keeps the detach behavior `changes` consumers may rely on, but re-introduces the detach-while-invalidation-needs-it hazard). Recommendation: permanent once attached — the invalidation reasoning applies to the whole factory, and a consumer with an expensive subscription controls it by not configuring `subscribe`.
2. **Notify dispatch.** `factory.changes` dispatches via `reportInBackground` (async, errors swallowed); invalidation runs synchronously inside the provider notify — and must stay synchronous (the write-generation race in resolve.ts assumes it). Does the broadcaster dispatch synchronously and let `changes` keep its own async wrapping? Recommendation: yes.
3. **Throwing subscribe.** `attachInvalidationSubscription` reports a throwing `subscribe` through `onCacheError` and continues (resolve.ts:161-166); `factory.changes` lets it throw to the `changes.subscribe` caller. Pick one reporting path for the broadcaster.

## Changes (once questions close)

- `src/factory.ts` — create the broadcaster; `changes` delegates; delete the local ref-count.
- `src/lib/evaluation/resolve.ts` — subscribe the invalidation listener through the broadcaster; delete the `subscription` attach bookkeeping from `ResolutionState`.
- `docs/agents/domain.md` — document the single-attachment contract on the factory.

## Tests

- New: broadcaster unit tests — attach on first listener, idempotent unsubscribe, synchronous notify during attach, the decided lifetime.
- Regression: config with both `changes` listeners and a cache — consumer `subscribe` called exactly once (the new contract; today it is twice).
- Existing lifecycle.test.ts invalidation suite and resolve.test.ts must pass unchanged — they pin the synchronous-invalidation semantics that constrain question 2.

## Verification

- `bun test`, `bun run build`, `bun run check`, `bun run analyze`

## Release

- Changeset: minor. "A factory attaches the configured `subscribe` at most once, fanning out to invalidation and `factory.changes`. Consumers whose `subscribe` counted attachments observe one attachment instead of two."
