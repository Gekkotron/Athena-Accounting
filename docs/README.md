# Athena-Accounting Documentation

Athena-Accounting is self-hosted personal accounting for people who
want their bank data to stay on their own network. This is the deep
dive; if you just want to install and run, the [top-level README](../README.md)
covers the quickstart.

The docs are split into two tracks and a reference bucket.

## For users

You installed Athena (or plan to) and want to understand it.

- **[Getting started](users/getting-started.md)** — install, first-run
  onboarding, your first ten minutes.
- **[Importing](users/importing.md)** — OFX, French CSV, and PDF bank
  statements, including the interactive template wizard.
- **[Categorization](users/categorization.md)** — rules, the Tri tab,
  internal transfer detection.
- **[Dashboard](users/dashboard.md)** — balance chart, category donut,
  insights, Sankey, budgets.
- **[Accounts & data](users/accounts-and-data.md)** — multi-account,
  balance checkpoints, locked money, backups.
- **[Security & privacy](users/security-and-privacy.md)** — argon2id,
  sessions, privacy mode, LAN-only posture.
- **[MCP access](users/mcp.md)** — optional local Model Context
  Protocol server for LLM access.
- **[Troubleshooting](users/troubleshooting.md)** — FAQ and common
  issues.

## For contributors

You want to read, fix, or extend the code.

- **[Architecture](contributors/architecture.md)** — system diagram,
  service split, request flow.
- **[Code map](contributors/code-map.md)** — directory tour.
- **[Development](contributors/development.md)** — local setup, running
  tests, PR flow.
- **[Database](contributors/database.md)** — schema highlights and
  migrations.

## Reference

Pure lookup, no narrative.

- **[Configuration](reference/configuration.md)** — environment
  variables, ports, defaults.
- **[API endpoints](reference/api-endpoints.md)** — REST surface.
- **[Glossary](reference/glossary.md)** — French UI ↔ English terms.

## Not what you're looking for?

- The **[top-level README](../README.md)** is the entry point for
  installing Athena.
- **Bugs and requests** live on the [issue tracker](https://github.com/Gekkotron/Athena-Accounting/issues).
- If Athena helps you, consider **[sponsoring the project](https://github.com/sponsors/Gekkotron)**.
