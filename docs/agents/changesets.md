# Changesets

This repository uses Changesets for versioning and changelog management.

## Agent rules

- Add a changeset for public API changes, bug fixes, runtime dependency changes, and
  documentation shipped with the package.
- Do not add a changeset for tests, CI, contributor documentation, release tooling, or
  internal maintenance.
- Use `pnpm exec changeset` to create a changeset and commit the generated `.changeset/*.md`
  file.
- Never make a major version bump unless the user requests it.
- Alert the user when a change is breaking. Before version 1.0.0, release a breaking
  change as a minor bump.
