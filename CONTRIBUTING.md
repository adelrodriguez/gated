# Contributing to Gated

## Setup

Gated uses Bun. Fork and clone [adelrodriguez/gated](https://github.com/adelrodriguez/gated), then install dependencies:

```sh
bun install
```

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

## Quality checks

Run the checks relevant to your change before opening a pull request:

```sh
bun test
bun run build
bun run check
bun run analyze
bun run format -- --check
```

`check`, `analyze`, and `format` use Adamantite with OXC tooling. To apply lint or formatting fixes, run `bun run fix` or `bun run format`.

There is no separate `typecheck` script.

## Changesets

Add a Changeset for a published, user-facing behavior or API change:

```sh
bunx changeset
```

Commit the generated file in `.changeset/` with the pull request. Do not add a Changeset for documentation-only, test-only, or internal changes that do not affect package consumers.

## Pull requests

Keep changes focused, add or update tests for behavior changes, and explain the user-visible effect. Link related GitHub issues when applicable.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
