# Gated React showcase

An interactive Next.js App Router application that demonstrates every public capability of `gated` with a local in-memory flag provider. It includes boolean and typed variant decisions, evaluation details and payloads, server batching, identity overrides, anonymous evaluation, React Suspense gates, cache invalidation, `FeatureGate`, observer hooks, built-in cache and request coalescing, timeout and abort behavior, and typed fallback errors.

The example is the executable reference for its acceptance criteria and design decisions.

## Run locally

From this directory:

```sh
bun install
bun dev
```

No root build is required. State is held in `globalThis`, survives development HMR, and resets when the process restarts.

## Consumer code vs. demo provider

The example keeps the code a package consumer would write separate from the fake provider used to make the showcase interactive:

```text
src/shared/gates/
  server.ts              buildGate factories, hooks, and gate definitions
  client.ts              browser gate factory and custom hook

src/shared/demo-provider/
  adapter.ts             fake decide/decideMany adapter returning gated Decisions
  model.ts               seeded demo flag configuration
  store.ts               in-memory state, admin mutations, counters, log, and cache

src/app/api/decide*/     HTTP transport from the client factory to the demo provider
```

Start in `shared/gates/` for copyable `gated` usage. Everything under `shared/demo-provider/` is showcase infrastructure and would be replaced by an SDK or adapter for a real flag provider.

## Source aliases

Example code imports the real public paths (`gated`, `gated/hooks`, and `gated/react`), while TypeScript and Next map those paths directly to `../../src`. This keeps consumer snippets realistic and gives live HMR without adding the root package as a workspace or copied `file:` dependency. Both Turbopack and webpack aliases are configured in `next.config.mjs`.

## Guided tour

1. Switch the header identity to Bob.
2. Open **Admin**, change Bob’s `new-dashboard` override, and submit it.
3. Open **Server** to see the new decision and full details immediately.
4. Open **Client**, return to Admin to flip the value again, then come back. The client gate remains cached until **Invalidate this identity** is pressed.
5. Open **Advanced** to run request coalescing, server cache, timeout, and abort experiments and inspect every hook phase in the event log.

## Deploy

For Vercel, set the project root directory to `examples/react` and enable **Include source files outside of the Root Directory** so the `../../src` aliases are bundled. The app uses the Node runtime and standalone output.

The flag store is per-process memory. Vercel does not guarantee that requests use the same instance, so an admin mutation may occasionally be read by another instance with different state. For strict single-store demo behavior, deploy one container to Railway, Fly.io, or Render and run `bun start` after `bun run build`.
