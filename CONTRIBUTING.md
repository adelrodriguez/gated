# Contributing to Gated

Thank you for contributing to Gated.

## Requirements

- [Node.js](https://nodejs.org) 26.
- [pnpm](https://pnpm.io) 12.
- [Git](https://git-scm.com).

## Set up the repository

1. Fork and clone the repository.
2. Install dependencies:

   ```sh
   pnpm install
   ```

3. Create a branch for the change.

Read [CONTEXT.md](CONTEXT.md) and [docs/agents/domain.md](docs/agents/domain.md) before you
change behavior or terminology. Use the project's domain language.

## Layout

```text
src/
  index.ts                Root public API
  factory.ts              Gate factory and batch construction
  decision.ts             Decision helpers
  lib/                    Evaluation engine, cache, and shared types
  hooks/                  Hook factory
  integrations/react.tsx  React integration, published as gated/react
  **/__tests__/           Colocated tests
vitest.config.ts          Test and coverage configuration
```

The public package entry points are `gated`, `gated/hooks`, and `gated/react`. `dist/` is build output.

## Development commands

```sh
pnpm run build          # Build the published package into dist.
pnpm run build:verify   # Build and test the packed package.
pnpm run dev            # Rebuild when source files change.
pnpm run test           # Run the Vitest suite.
pnpm run test:watch     # Run tests when files change.
pnpm run test:coverage  # Run tests and collect coverage.
pnpm run check          # Check lint rules and TypeScript types.
pnpm run fix            # Apply safe lint fixes.
pnpm run format         # Format repository files.
pnpm run analyze        # Find unused files, exports, and dependencies.
```

`check`, `fix`, `format`, and `analyze` use Adamantite. There is no separate `typecheck`
script.

## Make a change

- Keep the gate factory in `src/factory.ts`, the decision helpers in `src/decision.ts`,
  and the core implementation in `src/lib/`.
- Keep hooks in `src/hooks/`.
- Keep the React integration in `src/integrations/react.tsx`.
- Add or update colocated tests for behavior changes.
- Update user documentation when public behavior, types, or entry points change.
- Consider package consumers before you change `gated`, `gated/hooks`, or
  `gated/react`.

## Validate a change

Run the full repository workflow before you open a pull request:

```sh
pnpm run test
pnpm run build:verify
pnpm run check
pnpm run fix
pnpm run format
```

Run `pnpm run analyze` after you add or remove dependencies or change imports and exports.
Review all automatic fixes before you commit them.

## Changesets

Add a changeset for a change that affects users of the published package. Examples include
public API changes, bug fixes, runtime dependency changes, and documentation shipped with
the package.

```sh
pnpm exec changeset
```

Commit the generated `.changeset/*.md` file with the pull request. Do not add a changeset
for tests, CI, contributor documentation, release tooling, or other internal maintenance.
Do not create a major changeset unless the breaking change is intentional and approved.

## Pull requests

In the pull request description, explain:

- What changed.
- Why the change is needed.
- How you validated the change.
- Whether the change affects public behavior or requires migration.

All CI checks must pass before merge. Link related GitHub issues.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
