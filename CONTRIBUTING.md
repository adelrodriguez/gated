# Contributing to Gated

Thank you for your interest in contributing to Gated! This document provides guidelines and instructions for contributing to the project.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.3.0 or higher
- TypeScript knowledge

### Installation

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/gated.git
   cd gated
   ```
3. Install dependencies:
   ```bash
   bun install
   ```

## Project Structure

```
src/
├── index.ts          # Main entry point
├── core.ts           # Core gate functionality
├── react.tsx         # React integration
├── hooks/            # Hook system
│   ├── index.ts      # Hook creation utilities
│   └── recipes.ts    # Built-in hooks (cache, dedupe)
└── lib/              # Types and utilities
```

## Development Workflow

### Running Tests

```bash
# Run all tests
bun test

# Watch mode for development
bun test:watch
```

### Code Quality

```bash
# Check linting and formatting
bun run check

# Auto-fix linting issues
bun run fix

# Type checking
bun run typecheck
```

All three checks must pass before submitting a PR.

## Making Changes

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring

### Commit Messages

Write clear, concise commit messages that describe what changed and why:

```
feat: add support for numeric variant flags

Extends variant flags to support number types in addition to strings.
```

### Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Format code using Biome (via `bun run fix`)
- Ensure type safety - avoid `any` types

### Testing

- Add tests for new features
- Update tests when modifying existing functionality
- Ensure all tests pass before submitting
- Test files live alongside source files in `__tests__` directories

## Changesets Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

### When to Add a Changeset

Add a changeset for any user-facing changes:

- New features
- Bug fixes
- Breaking changes
- Deprecations

Skip changesets for:

- Documentation updates
- Internal refactoring without behavior changes
- Test updates

### Creating a Changeset

```bash
bunx changeset
```

Follow the prompts to:

1. Select the type of change (major, minor, patch)
2. Write a summary of the change

The changeset file will be created in `.changeset/` and should be committed with your PR.

#### Change Types

- **Major** (breaking changes): API changes that require user code updates
- **Minor** (new features): Backwards-compatible new functionality
- **Patch** (bug fixes): Backwards-compatible bug fixes

## Submitting a Pull Request

### Before Submitting

Ensure your PR meets these requirements:

- [ ] Code follows the project's style guidelines
- [ ] All tests pass (`bun test`)
- [ ] Type checking passes (`bun run typecheck`)
- [ ] Linting passes (`bun run check`)
- [ ] Changeset added (if applicable)
- [ ] Documentation updated (if needed)

### PR Process

1. Push your changes to your fork
2. Create a pull request against the `main` branch
3. Fill out the PR template with:
   - Description of changes
   - Motivation and context
   - Breaking changes (if any)
   - Related issues
4. Wait for CI checks to pass
5. Address review feedback

### CI Checks

Pull requests must pass:

- **Lint** - Code style and formatting
- **Typecheck** - TypeScript compilation
- **Test** - All test suites

## Getting Help

- Open an [issue](https://github.com/adelrodriguez/gated/issues) for bug reports or feature requests
- Check existing issues before creating a new one
- Provide as much context as possible

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions. We're here to build great software together.

## License

By contributing to Gated, you agree that your contributions will be licensed under the MIT License.
