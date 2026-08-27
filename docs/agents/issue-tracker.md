# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues. Use the `gh` CLI for all
operations.

## Repository

`adelrodriguez/gated`

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list`
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repository from the Git remote when possible.

## Pull requests

Do not use pull requests to request triage.

## Skill operations

When a skill says to publish to the issue tracker, create a GitHub issue. When a skill says
to fetch a ticket, read the GitHub issue and its comments. Use GitHub sub-issues and native
dependencies for wayfinding when available.
