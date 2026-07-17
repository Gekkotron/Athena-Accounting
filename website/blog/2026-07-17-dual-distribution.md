---
slug: dual-distribution
title: One codebase, two installs — Athena ships as a desktop app
authors: [Gekkotron]
tags: [release, desktop, docker, tauri]
draft: true
---

Athena Accounting now ships in two flavours from the same repo. The
family-server Docker stack you already know is unchanged. Alongside it,
there's a new **desktop app** — a single download for macOS, Windows,
or Linux, no Docker, no prerequisites, single user.

Both paths run the same features, the same UI, and the same backup
format. The choice is really "who is going to use this instance?" —
one person on one machine, or a whole household from any browser on
the LAN.

<!-- truncate -->

## Why two paths?

The Docker stack was designed for a *family server* — a mini-PC or NAS
that sits in a closet, Postgres running behind Fastify behind nginx,
everyone in the house pointing their browser at
`http://home.lan:8000`. That model is great when it fits, but it asks
a lot of a solo user who just wants to keep track of their own bank
statements: they have to know what Docker is, install it, keep it
running, and open the right port on the right machine.

The desktop app strips all of that away. You download a `.dmg` (or
`.exe`, or `.AppImage`), double-click it, and Athena opens like any
other application. Everything — the Fastify backend, the React
frontend, the database — runs inside the app on your own machine, on a
port bound to `127.0.0.1` that nothing else can reach.

## What's shared, what's different

**Shared.** All the imports (OFX, CSV, PDF with the template wizard),
the categorisation rules, internal transfer detection, the dashboard,
the Sankey, the budgets, the MCP endpoint, the backup format — all the
same code. Fixes and features land in both paths on the same day.

**Different.** The desktop app runs single-user with a local PGlite
database and no LAN listener. The Docker stack runs multi-user with
Postgres and binds to every interface on the host so your other devices
can reach it. Both stay entirely local; neither talks to the cloud.

You can migrate between them at any time by exporting a backup on one
side and importing it on the other. Same JSON, same schema.

## Under the hood

The desktop app is a **Tauri 2 shell** wrapping the existing backend as
a **directory-based sidecar**: a bundled Node 22 runtime + an esbuild
bundle of the Fastify app + prebuilt native modules (sharp, canvas,
argon2, PGlite WASM, pdfjs worker, tesseract). The shell (~50 lines of
Rust) spawns the sidecar, reads `ATHENA_PORT=…` from its stdout, and
opens a window pointed at `http://127.0.0.1:{port}`. Closing the window
sends `SIGTERM`; no zombie process, no leftover port.

Two decisions worth calling out:

- **PGlite instead of embedded Postgres.** PGlite is Postgres compiled
  to WASM, running in-process. We already use `drizzle-orm`, and every
  migration and query in the repo now runs cleanly under both the
  Postgres driver (Docker path) and the PGlite driver (desktop path).
  A single `DB_DRIVER` env flag flips between them.
- **Directory sidecar instead of single-binary.** Athena's native-deps
  tree (sharp/libvips, canvas, argon2, PGlite WASM, pdfjs, tesseract)
  is hostile to single-binary bundlers. Tauri's sidecar mechanism
  accepts a folder just as happily, so we ship the whole tree and let
  Tauri pick it up as a bundled resource. Bundle size is 50–80 MB per
  platform — larger than a single stripped binary, but reliable.

## Getting it

- **Desktop app** — download from the
  [latest release](https://github.com/Gekkotron/Athena-Accounting/releases/latest)
  and follow the [desktop install guide](/docs/users/desktop-install).
- **Docker stack** — clone the repo and follow the
  [getting-started guide](/docs/users/getting-started).

## Caveats

- **Unsigned binaries** on macOS and Windows for now. macOS asks you to
  right-click → Open on first launch; Windows SmartScreen shows "Run
  anyway". This will change once the project has an Apple Developer
  certificate.
- **No auto-updates yet.** The desktop app doesn't check for new
  versions. Watch the GitHub releases page (or star the repo) if you
  want to know when something new lands.

Feedback, bugs, and "it doesn't work on my
&lt;distro/window-manager/CPU-arch&gt;" reports are welcome on the
[issue tracker](https://github.com/Gekkotron/Athena-Accounting/issues).
