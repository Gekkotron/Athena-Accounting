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

See [`docs/users/getting-started.md`](docs/users/getting-started.md) for how
to get the app running locally (both the Docker path and the Desktop path).

## Maintainer bandwidth

Athena Accounting is maintained by a single person in spare time. That means:

- Issue triage and PR review may take days, occasionally weeks.
- Larger features may be closed with a "not in scope" note — please open an
  issue to discuss significant changes **before** starting the work.
- The maintainer reserves the right to decline contributions that don't fit
  the project's direction, even if the code is correct.

Thanks for understanding, and thanks for contributing.
