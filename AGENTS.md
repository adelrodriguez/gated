# Gated Agent Guide

## Scope

Gated is a single-package, provider-agnostic TypeScript feature-flag library. Read [CONTEXT.md](CONTEXT.md) and [docs/agents/domain.md](docs/agents/domain.md) before changing behavior or terminology.

## Layout and public API

- Core implementation: `src/core.ts` and `src/lib/`
- Hooks and recipes: `src/hooks/`
- React integration: `src/integrations/react.tsx`, published as `gated/react`
- Tests: colocated in `src/**/__tests__/`
- Public entry points: `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react`

Do not change a public entry point or its types without considering package consumers.

## Quality commands

Use Bun:

```sh
bun test
bun run build
bun run check
bun run analyze
bun run format -- --check
```

`check`, `analyze`, and `format` are Adamantite commands using OXC tooling. Use `bun run fix` or `bun run format` only when writing fixes. There is no separate `typecheck` script.

## Changesets

Run `bunx changeset` and commit the generated `.changeset/*.md` file for user-facing published changes, including public API changes and bug fixes. Skip Changesets for documentation-only, test-only, and internal non-user-facing changes.

## Agent skills

### Issue tracker

Work is tracked in GitHub Issues for `adelrodriguez/gated`. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Use the canonical triage labels in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

This is a single-context repository. See [docs/agents/domain.md](docs/agents/domain.md).

<!-- ADAMANTITE:START -->

## Adamantite

This project uses Adamantite for its managed formatting, linting, type checking, and dependency-analysis setup.

- Prefer the package scripts Adamantite added for this workspace.
- Run `bun run format` after editing files. Direct command: `adamantite format`.
- Run `bun run check` to catch lint and type issues. Direct command: `adamantite check`.
- Run `bun run fix` to apply safe lint fixes. Direct command: `adamantite fix`.
- Run `bun run analyze` after changing dependencies, imports, or exports. Direct command: `adamantite analyze`.
- Use `adamantite doctor` to inspect managed setup and `adamantite doctor --fix` for safe local fixes.

<!-- ADAMANTITE:END -->

<!-- PACKREF:START -->

## Packref

Packref provides local copies of dependency source code so you can inspect the exact implementation used by this project.

- Source references are stored in `.packref/packages/<registry>/<package>/<version>/` for unscoped packages and `.packref/packages/<registry>/<scope>/<package>/<version>/` for scoped packages — browse these directories to read dependency internals
- `.packref/packref-lock.json` is shared and should be committed; `.packref/packages/` is developer-local and git-ignored
- Run `packref install` after cloning when locked references are missing; install restores locked references exactly and does not install runtime dependencies
- Available commands:
  - `packref add [package]` — select manifest dependencies or fetch a named package (e.g. `packref add react`, `packref add hono@4.2.0`, `packref add @effect/cli`)
  - `packref remove [package]` — select or name package references to remove
  - `packref install` — materialize every reference already recorded in the committed lockfile
  - `packref sync` — update dependency-tracked lock entries to match current `package.json` dependency versions
  - `packref list` — show all referenced packages
  - `packref prune` — remove unused entries from the global store
  - `packref clean` — remove all project-local references
  - `packref clean --global` — wipe all global store entries
- Use Packref when you need to understand how a dependency works internally — read the source in `.packref/` instead of guessing or searching the web
- Multiple versions of the same package can coexist; check `.packref/packref-lock.json` for the full list

<!-- PACKREF:END -->
