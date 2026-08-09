# Examples: React showcase app (`examples/react`)

Status: approved by Adel on 2026-08-09, ready to implement. This spec is self-contained for handoff: every decision below has already been reviewed — do not re-litigate them; flag genuine blockers instead.

## Goal

A Next.js (App Router) showcase app at `examples/react` that demonstrates every public capability of `gated` against a purely local, in-memory flag store — no external feature-flag provider. Users of the demo can switch identities, toggle flags, and watch server-side and client-side gates react. The folder is `examples/react` (not `examples/nextjs`) to leave room for future sibling examples per framework.

## Approved decisions (context for the implementer)

1. **Consume the library as source, not as a built package.** Alias `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react` to `../../src/...` (see "Library consumption" below). Verified constraints that forced this: Bun cannot resolve `workspace:*` against the repo root (the library _is_ the root package), and Bun `file:` deps are copied at install time (a `dist/` built afterward never appears in `node_modules`). Source aliasing matches how the `metaideas/init` template consumes internal packages (raw `./src/*.ts` exports) and gives live HMR when editing the library. Example code still writes `import { buildGate } from "gated"`, so showcased code reads like real consumer code. The published exports map stays covered by the existing `check:exports` script.
2. **`examples/react` is a standalone Bun project** with its own `package.json` and `bun.lock`. Do not add a `workspaces` field to the root `package.json`; do not modify the published package at all.
3. **Structure follows the `metaideas/init` conventions** (Adel's template, github.com/metaideas/init): `src/` with a one-way import flow — routing layer (`src/app`) → `src/features` → `src/shared`. Features are vertical slices that never import each other or the routing layer; `shared` imports from neither. Use package.json subpath imports (`"imports": { "#*": "./src/*" }`), not tsconfig path aliases, for internal app imports.
4. **Deploy target: Vercel**, root directory `examples/react`, with the known caveat that server memory is per-instance (see "Deployment").
5. **Styling: Tailwind CSS v4**, minimal, no component kit.

## Library consumption

- Example `package.json` dependencies: `next` (latest stable), `react` + `react-dom` (^19.2, matching the library peer range), Tailwind v4 tooling. `gated` is **not** listed as a dependency.
- Resolution mapping (apply in both `tsconfig.json` `paths` and Next config so dev, build, and typecheck agree):
  - `gated` → `../../src/index.ts`
  - `gated/hooks` → `../../src/hooks/index.ts`
  - `gated/hooks/recipes` → `../../src/hooks/recipes.ts`
  - `gated/react` → `../../src/integrations/react.tsx`
- Next must compile files outside the app directory. With Turbopack use `turbopack.resolveAlias`; if the webpack path is exercised, add `resolve.alias` and enable `experimental.externalDir`. Verify **both** `bun dev` and `bun run build` resolve the aliases before building features.
- The library has zero runtime dependencies, so aliasing to source pulls in nothing else.

## The in-memory "provider" (`src/shared/server/flag-store.ts`)

Server-only module. Stash state on `globalThis` so it survives Next dev HMR. Contents:

- **Flag configs**, keyed by flag key: kind (`boolean` | `variant`), global value, per-user override map (`distinctId` → value), optional variant payload, and simulation knobs: `latencyMs` (artificial delay) and `fail` (throw on decide).
- **Event log**: bounded ring buffer (~200 entries) of `{ timestamp, phase, flagKey, distinctId, detail }` records written by the logging hook and by `onHookError`.
- **Provider-call counter**: incremented on every `decide`/`decideMany` execution. This counter is what makes batching, dedupe, and caching _visibly_ real in the UI ("5 evaluations → 1 provider call").
- Mutation functions (used by server actions): set global value, set/clear per-user override, set variant, set knobs, reset store, clear log/counter.

Seeded flags:

| Key                  | Kind    | Values                                                                   | Purpose                                                      |
| -------------------- | ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `new-dashboard`      | boolean | —                                                                        | plain boolean toggle                                         |
| `beta-banner`        | boolean | —                                                                        | FeatureGate demo                                             |
| `checkout-theme`     | variant | `light` / `dark` / `system`, with payload (e.g. `{ accent, updatedAt }`) | variant + payload demo                                       |
| `pricing-experiment` | variant | `control` / `a` / `b`                                                    | multi-user variant matrix                                    |
| `flaky-flag`         | boolean | —                                                                        | latency/failure knobs → timeout, fallback, `details().error` |

Demo users: `alice`, `bob`, `carol` (fixed constants in `src/shared/flags.ts` or `src/shared/constants.ts`), plus an **Anonymous** option. Identity shape: flat, JSON-serializable `{ distinctId: string }` (required by the React cache key rules).

## Gate factories

### Server factories (`src/shared/server/gates.ts`)

1. **Main strict factory** — `buildGate` with:
   - `identify()`: read current user from a cookie (Next `cookies()`); the user switcher sets it via server action.
   - `decide` / `decideMany`: read the flag store directly, honor `signal` and the latency/fail knobs, increment the call counter.
   - `hooks`: a `defineHook` logging hook (writes before/after/error/finally + `meta.source` to the event log) and `dedupeHook()`. **Deliberately no `cacheHook` here** — a server-side decision cache would mask admin toggles and make the demo feel broken.
   - `onHookError`: writes to the event log.
   - `timeoutMs`: ~1000 (so the latency knob at e.g. 3000ms demonstrates `GateTimeoutError`).
2. **Anonymous factory** — same config plus `anonymous: "allow"`, `identify` returning `null` when the Anonymous user is selected. Used on the advanced page.
3. **Cached factory** — main config plus `cacheHook` backed by a store-visible in-memory cache. Used **only** in the advanced page's cache demo, with an explicit "clear server cache" button, so cache behavior is demonstrated where it's explained rather than silently affecting every page.

### Client factory (`src/shared/gates.client.ts`)

- `buildGate` whose `decide` POSTs `/api/decide` (`{ key, identity }` → `Decision` JSON) and `decideMany` POSTs `/api/decide-many` (`{ keys, identity }` → `Record<string, Decision>`). Route handlers read the same store, apply knobs, and increment the same counter — everything stays on this app's server.
- `identify()` returns a sensible default, but client components **pass explicit bare identities** to the React hooks (`useNewDashboard({ distinctId })`) sourced from a `UsersProvider` context hydrated from the cookie. This both sidesteps client-side identity plumbing and demonstrates identity overrides.
- `createReactGate` registrations for each flag live here (or in `features/client-demo` if only used there). Include one custom-async-function gate with a `cacheKey` projection to demonstrate that variant of the API.

## Route map (`src/app`, routing layer)

Persistent layout: nav + **user switcher** (Alice / Bob / Carol / Anonymous; server action sets the cookie, `revalidatePath("/")`-style refresh). All demo pages are `export const dynamic = "force-dynamic"`.

- **`/`** — overview: what gated is, diagram of the two factories and the in-memory store, links to each demo with one-line descriptions.
- **`/admin`** — control surface. Toggle global values, set per-user overrides, pick variants per user, set `latencyMs`/`fail` on `flaky-flag`, reset store. Server actions in `features/admin/server/functions.ts`.
- **`/server`** — RSC evaluation: each flag's value plus full `details()` (`value`, `source`, `error`) for the current user; a `gate.batch([...])` section showing before/after provider-call counts to prove one `decideMany` round trip; `batch.details()` on `checkout-theme` showing the payload.
- **`/client`** — `createReactGate` hooks under `<Suspense>`; `<FeatureGate>` with `loading` / `fallback` / `match` (boolean and variant forms); **invalidate / clear** buttons with a visible fetch counter. Scripted demo flow in the page copy: flip a flag in `/admin` → client stays cached → invalidate → re-fetch. Include an inline code-snippet panel explaining `createReactGateCache` per-request injection for SSR (live wiring is a stretch goal, not required — a shared module-level cache across requests is exactly the hazard the README warns about, so don't fake it).
- **`/matrix`** — server-rendered table: users × flags, one `gate.batch(flags, { identity })` per user, showing divergent decisions (overrides and variants per user).
- **`/advanced`** — grouped demos, each with a short explanation:
  - **Event log viewer** (refreshable) showing lifecycle phases and `meta.source`.
  - **Dedupe**: button fires 5 concurrent evaluations of one flag server-side; UI shows "5 evaluations, N provider calls" (N should be 1).
  - **Server cache**: cached factory; evaluate → hit/miss indicator via call counter; clear button; stale-decision validation note.
  - **Timeout**: set latency > `timeoutMs` → `details()` shows `GateTimeoutError`, value falls back to default.
  - **Abort**: client-side `AbortController` cancelling an in-flight evaluation (use the core evaluator directly, not the React hook — the README explains why hooks don't take signals).
  - **Anonymous**: anonymous factory evaluation, `identity: null` in hook context, cache/dedupe bypass explained.
  - **Failure**: `fail` knob → `details().source === "default"` with the typed error class name displayed (`MalformedDecisionError`, etc. where reachable).
  - **Hook errors**: a deliberately-throwing hook on a demo factory, its report surfaced via `onHookError` in the log — showing evaluation still succeeds.

## Feature-coverage checklist (acceptance)

Every row must be demonstrably visible in the UI:

- [ ] Boolean and variant flags with typed values
- [ ] `details()`: `source` (`provider` / `hook` / `default`), `error`, variant `payload`
- [ ] `gate.batch` + `decideMany` (single round trip proven by counter); `batch.details`
- [ ] Multiple users with divergent decisions; identity override via call options
- [ ] Anonymous evaluation (`anonymous: "allow"`), including cache/dedupe bypass
- [ ] `createReactGate` + Suspense; bare-identity hook calls; custom async gate with `cacheKey`
- [ ] `invalidate()` / `clear()` with visible re-fetch
- [ ] `<FeatureGate>` with `loading`, `fallback`, `match`
- [ ] `defineHook` lifecycle hook (all five phases in the log) + `onHookError`
- [ ] `cacheHook` and `dedupeHook` recipes with visible hit/dedupe evidence
- [ ] `timeoutMs` → `GateTimeoutError` fallback; `AbortController` cancellation
- [ ] Typed error classes surfaced by name in the failure demo
- [ ] `decision.boolean` / `decision.variant(value, payload)` helpers used in the store adapter

## Implementation order

1. Scaffold `examples/react` (Next + Tailwind + Bun, standalone lockfile); wire and **verify the source aliases in dev and build** before anything else.
2. Flag store + seeded flags + server factories + logging hook.
3. Layout + user switcher + `/admin` (the control surface unblocks manual testing of everything else).
4. `/server`, then API routes + client factory + `/client`.
5. `/matrix`, `/advanced`.
6. `/` overview, README, deploy config, polish.

## Verification

- `bun run build` and `bun dev` inside `examples/react` both succeed; typecheck via `next build` (or a `tsc --noEmit` script) passes.
- Root repo still healthy: `bun test`, `bun run check`, `bun run analyze` from the repo root. If root oxlint/knip/adamantite sweeps trip on the example, exclude `examples/` in the root tool configs — do not weaken root rules.
- Manual pass of the acceptance checklist above, per user including Anonymous.
- Run `bun run format` (adamantite) after editing files, per repo convention.

## Deployment

- **Vercel**: root directory `examples/react`, "Include source files outside of the Root Directory" enabled (needed for the `../../src` aliases). No library prebuild required. Node runtime, dynamic pages.
- **Known caveat (accepted)**: the store lives in instance memory; Vercel doesn't guarantee one instance, so an admin toggle can occasionally miss a read served by another instance. Low-traffic demos on Fluid compute are effectively single-instance. Add a small dismissible UI note stating this.
- README documents the strict alternative: single container (Railway/Fly/Render) running `next start` with standalone output.

## README (`examples/react/README.md`)

Must cover: what the demo shows (link the coverage checklist), how to run locally (`bun install && bun dev` inside `examples/react` — no root build needed), how the source aliasing works and why, the deployment setup + memory caveat, and a guided tour ("switch to Bob, open /admin, flip `new-dashboard`, watch /server vs /client").

## Out of scope / guardrails

- No external services, no database, no analytics, no auth. State resets on restart — say so in the UI.
- Do not modify the library's `src/` or the root `package.json` to make the example work; if something seems to require it, stop and flag it.
- Do not add the example to root CI or the published package `files`.
- Keep demo code idiomatic consumer code — the point of every snippet on screen is to be copy-pasteable by a gated user.
