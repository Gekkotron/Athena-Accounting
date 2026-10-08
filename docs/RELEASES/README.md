---
title: Releases
sidebar_position: 99
---

# Releases

The full tag-by-tag release history — every `vX.Y.Z` with its bundled
artifacts, checksums, and auto-generated changelog — lives on GitHub:

<p>
  <a
    href="https://github.com/Gekkotron/Athena-Accounting/releases"
    target="_blank"
    rel="noopener noreferrer"
  >
    <img
      src="https://img.shields.io/github/v/release/Gekkotron/Athena-Accounting?label=All%20releases%20on%20GitHub&color=brightgreen&style=for-the-badge"
      alt="All releases on GitHub"
    />
  </a>
</p>

The pages below are **milestone deep-dives** — a note is written for a
release only when there's something worth explaining in prose
(packaging pivots, Gatekeeper workarounds, major surface expansions).
Routine release-candidate re-cuts live only in the
[`CHANGELOG.md`](https://github.com/Gekkotron/Athena-Accounting/blob/main/CHANGELOG.md)
at the root of the repo.

## Milestone notes

- **[v1.0.0-desktop-beta1](./v1.0.0-desktop-beta1.md)** — the Docker →
  Tauri pivot ships; first standalone desktop build.
- **[v1.0.0-desktop-rc1](./v1.0.0-desktop-rc1.md)** — macOS Gatekeeper
  workaround (`xattr -cr`), security hardening, pre-public-release
  repo polish.
- **[v1.0.0-desktop-rc9](./v1.0.0-desktop-rc9.md)** — import surface
  expansion: four new file formats (QIF, MT940, Excel `.xlsx`, BAI2)
  land together under one Postgres enum migration.
