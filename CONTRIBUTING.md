# Contributing to Athena Accounting

Thanks for your interest in the project. This document covers how to file
issues, how to open pull requests, and what to expect from the maintainer.

## Filing issues

Before opening a new issue, please search existing issues (open and closed)
to check whether the topic has already been raised.

- **Bug reports** — use the "Bug report" issue template. Include reproduction
  steps, expected vs. actual behavior, your environment (OS, Docker vs.
  Desktop distribution, release version), and any relevant logs.
- **Feature requests** — use the "Feature request" template. Describe the
  problem you're trying to solve, a proposed solution, and why the change
  matters now.

Please keep one topic per issue.

## Pull requests

Contributions are welcome. Small, focused PRs are much easier to review than
sprawling ones.

### Commit message format

Commits follow the Conventional-Commits-style shape used throughout the
repo's history:

```
type(scope): subject
```

Examples pulled from `git log`:

- `docs(plan): backlog +1 — backup/restore drill + recovery playbook`
- `ci(desktop): pin per-OS bundle targets; skip WiX/MSI on Windows`
- `release(desktop): publish v1.0.0-desktop-beta1`
- `style(website): restyle Docusaurus site to match the app's identity`

Common `type` values in use: `feat`, `fix`, `docs`, `chore`, `ci`, `style`,
`refactor`, `test`, `release`. Keep the subject line imperative and under
~72 characters; use the commit body for detail if needed.

### PR checklist

- One logical change per PR.
- Tests pass locally where applicable.
- If the change is user-visible, update the relevant docs page.
- If the change touches UI, include a before/after screenshot.
- Flag breaking changes explicitly in the PR description.

## Development setup

The contributor track lives under [`docs/contributors/`](docs/contributors/):

- **[Development](docs/contributors/development.md)** — clone, `install.sh`,
  `docker compose up --build`, Vite HMR loop, typecheck + lint commands.
- **[Architecture](docs/contributors/architecture.md)** — the three-container
  stack (frontend / backend / postgres), an optional MCP container, and a
  worked example of an OFX import end-to-end.
- **[Code map](docs/contributors/code-map.md)** — where each concern lives
  in the tree, module by module.
- **[Database](docs/contributors/database.md)** — schema highlights, the
  hand-written SQL migration workflow, and what runs at server boot.

If you just want to browse the source before deciding to contribute, start
in **[Code map](docs/contributors/code-map.md)** — it's the fastest way
to orient inside `backend/src/domain/` and `frontend/src/pages/`.

## Testing matrix

| Suite | Command | Needs | Notes |
|-------|---------|-------|-------|
| Backend unit + route (no DB) | `cd backend && npm test` | Node 20 | DB-gated tests show as *skipped* — expected. |
| Backend DB-integration | `bash backend/scripts/test-db.sh` | Docker | Spins a throwaway Postgres; **never** point at your real DB. |
| Frontend unit | `cd frontend && npm test` | Node 20 | Vitest, co-located `__tests__/` next to sources. |
| Playwright — demo | `cd frontend && npx playwright test` | Node 20 | `playwright.config.ts`; runs the browser-only demo build. |
| Playwright — fullstack | `npx playwright test -c playwright.fullstack.config.ts` | Docker | Boots the full server + SPA. |
| Playwright — installed app | `npx playwright test -c playwright.installed.config.ts` | Built desktop bundle | Layer 2 smoke over the installed Tauri app. |

CI (`.github/workflows/ci.yml`) runs the full grid on every push — so if a
suite is red locally, it will be red in CI too. Run at least the backend
unit + frontend unit suites before pushing.

## Maintainer bandwidth

Athena Accounting is maintained by a single person in spare time. That means:

- Issue triage and PR review may take days, occasionally weeks.
- Larger features may be closed with a "not in scope" note — please open an
  issue to discuss significant changes **before** starting the work.
- The maintainer reserves the right to decline contributions that don't fit
  the project's direction, even if the code is correct.

Thanks for understanding, and thanks for contributing.
