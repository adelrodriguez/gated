# Contributing to Gated

Thank you for contributing to Gated.

## Requirements

- [Bun](https://bun.sh) 1.3.14 or later.
- [Git](https://git-scm.com).

## Set up the repository

1. Fork and clone the repository.
2. Install dependencies:

   ```sh
   bun install
   ```

3. Create a branch for the change.

Read [CONTEXT.md](CONTEXT.md) and [docs/agents/domain.md](docs/agents/domain.md) before you
change behavior or terminology. Use the project's domain language.

## Layout

```text
src/
  index.ts                Root public API
  core.ts                 Gate construction
  lib/                    Evaluation and shared types
  hooks/                  Hook factory and recipes
  integrations/react.tsx  React integration, published as gated/react
  **/__tests__/           Colocated tests
test/setup.ts             Test setup
```

The public package entry points are `gated`, `gated/hooks`, `gated/hooks/recipes`, and `gated/react`. `dist/` is build output.

## Development commands

```sh
bun run build          # Build the published package into dist.
bun run dev            # Rebuild when source files change.
bun run test           # Run the Bun test suite.
bun run test:watch     # Run tests when files change.
bun run test:coverage  # Run tests and collect coverage.
bun run check          # Check lint rules and TypeScript types.
bun run fix            # Apply safe lint fixes.
bun run format         # Format repository files.
bun run analyze        # Find unused files, exports, and dependencies.
bun run check:exports  # Check the built package entry-point types.
```

`check`, `fix`, `format`, and `analyze` use Adamantite. There is no separate `typecheck`
script.

## Make a change

- Keep core implementation in `src/core.ts` and `src/lib/`.
- Keep hooks and recipes in `src/hooks/`.
- Keep the React integration in `src/integrations/react.tsx`.
- Add or update colocated tests for behavior changes.
- Update user documentation when public behavior, types, or entry points change.
- Consider package consumers before you change `gated`, `gated/hooks`,
  `gated/hooks/recipes`, or `gated/react`.

## Validate a change

Run the full repository workflow before you open a pull request:

```sh
bun run test
bun run build
bun run check
bun run fix
bun run format
```

Run `bun run analyze` after you add or remove dependencies or change imports and exports.
Run `bun run check:exports` after a build when you change a public entry point or its
types. Review all automatic fixes before you commit them.

## Changesets

Add a changeset for a change that affects users of the published package. Examples include
public API changes, bug fixes, runtime dependency changes, and documentation shipped with
the package.

```sh
bunx changeset
```

Commit the generated `.changeset/*.md` file with the pull request. Do not add a changeset
for tests, CI, contributor documentation, release tooling, or other internal maintenance.
Do not create a major changeset unless the breaking change is intentional and approved.

## Pull requests

A pull request should explain:

- What changed.
- Why the change is needed.
- How the change was validated.
- Whether it changes public behavior or requires migration.

All CI checks must pass before merge. Link related GitHub issues when applicable.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
