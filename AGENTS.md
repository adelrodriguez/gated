# AGENTS.md

Use ASD-STE100 Simplified Technical English for all communication.

Before you explore or change code, read `CONTEXT.md` and
`docs/agents/domain.md`. Use the project's domain language.

## Agent skills

### Source references

When a skill requires a local dependency source checkout, use Packref. Add the package
with `bunx packref add <package>` and read its version-locked source under
`.packref/packages/`.

### Issue tracker

Issues and PRDs are GitHub issues at `adelrodriguez/gated`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain-doc layout. See `docs/agents/domain.md`.

### Changesets

Use Changesets for versioning and changelog management. See
`docs/agents/changesets.md`.

## Repository rules

- Use Bun for package management and scripts.
- Run `bun run test`, `bun run build`, `bun run check`, `bun run fix`, and
  `bun run format` after edits.
- Run `bun run analyze` after dependency, import, or export changes.
- Keep tests colocated in `src/**/__tests__/`.
- Keep core implementation in `src/core.ts` and `src/lib/`, hooks and recipes in
  `src/hooks/`, and the React integration in `src/integrations/react.tsx`.
- Treat `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react` as public entry
  points. Consider package consumers before changing their runtime behavior or types.
- Add or update tests for behavior changes.

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
