# Gated React example

A Next.js App Router application that exercises every public capability of `gated` against
a local in-memory flag provider. It covers the core API: boolean and variant gates,
evaluation details and payloads, batches, identity overrides, anonymous evaluation, hooks,
the built-in cache, request coalescing, timeouts, cancellation, and typed fallback errors.
It also covers the React integration: `useGate`, `useGateBatch`, `FeatureGate`, Suspense,
and the gate cache.

## Run the example

From the repository root:

```sh
pnpm install
pnpm --dir examples/react install
pnpm --dir examples/react dev
```

The example does not need a root build. The demo provider stores its state in `globalThis`,
so the state survives development HMR and resets when the process restarts.

## Consumer code and the demo provider

The example separates the code a package consumer would write from the fake provider that
makes the demo interactive:

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

Start in `shared/gates/` for `gated` usage you can copy. Everything under
`shared/demo-provider/` exists to make the demo interactive. A real application replaces it
with a provider SDK or adapter.

## Source aliases

Example code imports the real public paths: `gated`, `gated/hooks`, and `gated/react`.
TypeScript and Next map those paths to `../../src`. The snippets stay realistic, and edits
to the library source reload live without a workspace link or a copied `file:` dependency.
`next.config.mjs` configures the aliases for both Turbopack and webpack.

## Guided tour

1. Switch the header identity to Bob.
2. Open **Admin**, change Bob's `new-dashboard` override, and submit it.
3. Open **Server** to see the new decision and full details immediately.
4. Open **Client**, return to **Admin** to flip the value again, then come back. The client
   gate stays cached until you press **Invalidate this identity**.
5. Open **Advanced** to run the request coalescing, server cache, timeout, and abort
   experiments and to inspect every hook phase in the event log.

## Deploy

For Vercel, set the project root directory to `examples/react` and enable **Include source
files outside of the Root Directory** so the build can follow the `../../src` aliases. The
app uses the Node runtime and standalone output.

The flag store is per-process memory. Vercel does not guarantee that requests reach the
same instance, so a request after an admin mutation may reach an instance with older state.
For one shared store, deploy a single container to Railway, Fly.io, or Render and run
`pnpm start` after `pnpm run build`.
