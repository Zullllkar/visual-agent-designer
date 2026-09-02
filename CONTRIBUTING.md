# Contributing to Vibeboard

Thank you for your interest in contributing! This guide covers how to report bugs, request features, and submit pull requests.

## Table of Contents

- [Bug Reports](#bug-reports)
- [Feature Requests](#feature-requests)
- [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Commit Convention](#commit-convention)

## Bug Reports

Before creating a bug report, please [search existing issues](https://github.com/Zullllkar/vibeboard/issues) to avoid duplicates.

When filing a bug report, include:

1. **OS and browser** (e.g. Windows 11, Chrome 125)
2. **Node.js and pnpm versions** (`node -v` and `pnpm -v`)
3. **Steps to reproduce** — minimal, step-by-step
4. **Expected behavior** vs **actual behavior**
5. **Screenshots or screen recording** if applicable
6. **Console errors** (copy-paste the text, don't screenshot)

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).

## Feature Requests

Feature requests are welcome. Please:

1. Check the [Roadmap](ROADMAP.md) — it might already be planned.
2. Search [existing issues](https://github.com/Zullllkar/vibeboard/issues) for similar requests.
3. Describe the **use case** (not just the solution) — what problem does it solve?
4. If you have a proposed implementation, outline it briefly.

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).

## Pull Requests

### Before You Start

For significant changes (new features, major refactors), please open an issue first to discuss the approach. This saves everyone time.

### PR Checklist

- [ ] Fork the repo and create your branch from `main`
- [ ] Run `pnpm install` and `pnpm lint` — fix any lint errors
- [ ] Run `pnpm build` — ensure the build passes
- [ ] Test your changes manually in the browser (desktop + mobile)
- [ ] Don't commit temporary files (`.tmp-*`, logs, `.next/`)
- [ ] Write clear commit messages (see [Commit Convention](#commit-convention))
- [ ] Reference any related issues in your PR description

### PR Process

1. Fork & branch: `git checkout -b feat/your-feature` or `fix/your-bugfix`
2. Make your changes, keep commits focused
3. Push to your fork and open a PR against `main`
4. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md)
5. Respond to review feedback

## Development Setup

```bash
git clone https://github.com/<your-username>/vibeboard.git
cd vibeboard
pnpm install
pnpm dev
```

For the optional daemon:

```bash
pnpm daemon          # Terminal 1
# set VAD_DAEMON_URL=http://127.0.0.1:3921 in .env.local
pnpm dev             # Terminal 2
```

## Code Style

- **TypeScript**: Strict mode, no `any` without justification
- **React**: Function components, hooks, no class components
- **Styling**: Tailwind CSS 4 utility classes; avoid inline styles unless dynamic
- **Imports**: Use absolute paths (`@/components/...`), group by external → internal
- **Naming**: `camelCase` for variables/functions, `PascalCase` for components/types, `kebab-case` for files
- **No comments** unless the logic is non-obvious — code should be self-documenting

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`, `perf`

Examples:
```
feat(canvas): add multi-select drag-to-reorder
fix(pipeline): handle empty brief gracefully
docs(readme): add comparison table and demo section
```

## Questions?

- Open a [GitHub Discussion](https://github.com/Zullllkar/vibeboard/discussions) for general questions
- Open an [Issue](https://github.com/Zullllkar/vibeboard/issues) for bugs and feature requests

Thank you for contributing!
