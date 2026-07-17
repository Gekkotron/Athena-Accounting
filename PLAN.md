# Plan

## Backlog

### Docker + Tauri dual-track — foundational refactor

Goal: ship a Tauri desktop app (Mac/Windows/Linux) alongside the current Docker stack, from the same codebase. Docker path stays the family-server story; Tauri path is the "no install, no Docker" solo-user story. **Packaging pivoted from single-binary to directory-based sidecar** (2026-07-17) — the native-deps tree (sharp+libvips, @napi-rs/canvas, argon2, PGlite WASM, pdfjs worker, tesseract) is hostile to single-binary bundlers, and Tauri's sidecar mechanism accepts a folder just as happily.



- [ ] Packaging workflow + CI
      GH Actions workflow `.github/workflows/desktop-release.yml`. Trigger: tag push matching `v*-desktop`.
      Matrix `macos-latest`, `ubuntu-latest`, `windows-latest`. Each job runs `desktop/scripts/build-sidecar.sh` for its own platform (produces `desktop/sidecar/` populated with the right Node binary + prebuilds), builds the frontend (`npm run build`), builds the Tauri app (`cargo tauri build`), then uploads `.dmg` / `.AppImage` / `.exe` as GH Release artifacts.
      Skip macOS code-signing initially (users get the "unidentified developer" dialog once; documented workaround). Revisit once we have an Apple Developer account.
      Success criteria: pushing `v1.0.0-desktop-rc1` produces a draft release with three artifacts, each installable on their target OS and each launching the app successfully.

- [ ] MCP compatibility check
      The MCP endpoint (`/api/mcp/rpc`) must still be reachable in Tauri mode.
      Tauri binds to `127.0.0.1` on a random port — Claude Desktop, Cursor, etc. need to know that port. Options: (a) ship a Tauri "menu bar" indicator that shows the current port + a "Copy MCP config" button, or (b) write the current port to a well-known file (`${DATA_DIR}/.mcp-port`) that Claude Desktop's config can reference.
      Pick one, implement, verify against real Claude Desktop MCP config.
      Success criteria: installing the Tauri app + configuring Claude Desktop's MCP settings from the app's provided config → Claude successfully calls an Athena MCP tool.

- [ ] Docs
      `docs/users/desktop-install.md`: download links, first-run flow, where data lives per OS, how to back up.
      Update `docs/users/getting-started.md`: two-path fork at the top — "Family server (Docker)" vs "Solo user (Desktop)". Neither disparages the other.
      Update `README.md`: install badges for both paths; the Docker prerequisite disclaimer that currently sits at the top becomes conditional on the Docker path.
      Blog post announcing dual distribution once release lands.

### Cross-cutting risks to flag before starting

- **PGlite maturity** — 0.x. Extensions and some advanced JSON features unsupported. Athena's schema doesn't use those, but each task above should be verified rather than assumed.
- **Tauri code-signing on macOS** — needs an Apple Developer account ($99/yr) to avoid Gatekeeper warnings. Not blocking; document the workaround for now.
- **Bundle size** — directory-based sidecar is ~50–80 MB per platform (Node runtime ~30 MB + sharp/libvips ~15 MB + canvas/PGlite/pdfjs/tesseract adding more). Larger than a single stripped binary, but reliable. Note in release notes.
- **Cross-arch Node binaries** — macOS-arm64 hosts building macOS-x64 (or vice versa) need `unofficial-builds.nodejs.org` or a matching runner in CI. The packaging workflow's matrix strategy handles this automatically.

## In progress

## Done

- [x] Tauri shell in `desktop/`
      New `desktop/` folder (Tauri 2, Rust). `src-tauri/tauri.conf.json` declares the **sidecar directory** built above as a bundled resource, and configures Tauri's sidecar mechanism to spawn `./sidecar/node ./sidecar/entry.js` (path resolved via Tauri's resource dir).
      Rust code (~40–60 lines): spawn sidecar, read `ATHENA_PORT=…` from stdout, open the main window pointed at `http://127.0.0.1:{port}`, kill sidecar on window close.
      App icon: convert `website/static/img/logo.svg` to `.icns` (Mac), `.ico` (Windows), and `.png` (Linux 512×512).
      Success criteria: with a locally-built `desktop/sidecar/` in place, `cargo tauri dev` opens a window showing the frontend, hitting the sidecar's Fastify. Closing the window shuts down the sidecar cleanly (no zombie process).

- [x] Package the backend as a directory-based sidecar
      Build a self-contained `desktop/sidecar/` layout for the current dev host (macOS-arm64 first; cross-compile happens in the packaging task below).
      Layout: `desktop/sidecar/node` (bundled Node 22 runtime) + `desktop/sidecar/entry.js` (a single esbuild bundle of `backend/src/entry/tauri.ts`, `--platform=node --bundle --external:` for anything with native binaries) + `desktop/sidecar/prebuilds/` (native modules copied out of `node_modules` post-install: `sharp`, `@napi-rs/canvas`, `@node-rs/argon2`, PGlite `.wasm`, `pdfjs-dist` worker, `tesseract.js` traineddata as needed).
      Add a `desktop/scripts/build-sidecar.sh` (or `.mjs`) that: downloads the Node binary for the target platform (unofficial-builds.nodejs.org for cross-arch if needed, else nodejs.org/dist), esbuilds the entry, copies prebuilds. Runs cleanly on the dev host with no CI dependency.
      Boot check: `./desktop/sidecar/node ./desktop/sidecar/entry.js` prints `ATHENA_PORT=<n>`, `curl 127.0.0.1:<n>/health` returns `{ok:true}`.
      Do NOT try to cross-compile inside this task — that's the packaging workflow's job. Ship a working single-platform sidecar as proof.
      Success criteria: `desktop/sidecar/` builds locally from a clean checkout; the sidecar boots standalone and answers `/health`; the layout is documented in `desktop/README.md` so the packaging task knows what to bundle per platform.

- [x] Serve the frontend from Fastify
      Add `@fastify/static` and register it in `buildServer()` under `NODE_ENV=production` (or a new `SERVE_STATIC` flag): serves `frontend/dist/` from `/`.
      Same Fastify serves both API and UI — matches how Docker Compose already routes.
      Success criteria: with the sidecar running, opening `http://127.0.0.1:{port}/` shows the app; API requests to `/api/*` still work.

- [x] Data-directory helper
      Add `backend/src/dataDir.ts` — returns the working directory for user data (PGlite file, backups, uploads).
      Reads `DATA_DIR` env; falls back to `/data` (Docker) or CWD (dev). Refactor backup routes, the PGlite path from the Tauri-entry task, and any hardcoded file paths through this helper.
      Success criteria: grep for hardcoded `/data` shows only tests + docs; both driver paths respect `DATA_DIR`.

- [x] Make auth optional via `AUTH_MODE=none|session`
      Session middleware, cookie parser, and `requireAuth` hooks become no-ops when `AUTH_MODE=none` — routes still register, but `req.userId` is populated from a single hard-coded local user seeded on first boot.
      Default: `session` (Docker path unchanged). Existing session-based tests continue to run under `AUTH_MODE=session`. Add a small parallel suite that boots under `AUTH_MODE=none` and confirms authenticated routes work without a login round-trip.
      Success criteria: Docker behavior byte-identical; Tauri build reaches `/api/accounts` without logging in.

- [x] Add Tauri entry point (`backend/src/entry/tauri.ts`)
      Reads env with `DB_DRIVER=pglite`, `AUTH_MODE=none`, `DATA_DIR=<from env>`.
      Runs migrations against the PGlite file at `${DATA_DIR}/athena.db`. Calls `build()` from the previous task.
      Binds to `127.0.0.1` on `port: 0` (OS-assigned). After `listen()` resolves, prints exactly one line to stdout: `ATHENA_PORT=<port>` — the Rust shell parses this. Handles SIGTERM cleanly (Rust shell sends it on window close).
      Success criteria: run `node dist/entry/tauri.js` standalone, see `ATHENA_PORT=54321` (or similar), `curl 127.0.0.1:54321/health` returns `{ok:true}`.

- [x] Extract `buildServer()` from `backend/src/server.ts`
      Current `server.ts` mixes app construction with process-level boot (SIGINT/SIGTERM, `runMigrations()`, `listen()`).
      Split into two files: `backend/src/buildServer.ts` exports `build(opts)` factory (pure app construction), and `backend/src/entry/server.ts` is the Docker/LAN entry (reads env, runs migrations, binds `0.0.0.0:PORT`, wires signals — preserves current behavior).
      Update `package.json` `dev` and `start` scripts to point at the new entry.
      Success criteria: existing backend test suite passes unchanged. `npm run dev` boots the app identically.

- [x] Verify Drizzle migrations run on PGlite
      Point `runMigrations()` at the PGlite adapter when `DB_DRIVER=pglite`.
      Sweep raw SQL clauses (`date_trunc`, `interval`, `NUMERIC(14,2)`, `sql\`...\`` blocks) for PGlite compatibility. All are supposed to work — verify empirically, patch what doesn't.
      Add a smoke test: boot with `DB_DRIVER=pglite` on an empty DB, run migrations, do one insert + one select round-trip on `users` and `transactions`.
      Success criteria: all existing DB migrations apply cleanly on PGlite; smoke test green.

- [x] Abstract the DB driver behind a factory
      Introduce `DB_DRIVER=postgres|pglite` env var (default `postgres`). Refactor `backend/src/db/client.ts`: build the Drizzle instance from the driver, not directly from `pg.Pool`. Postgres path stays default and behaves identically. Add `@electric-sql/pglite` + `drizzle-orm/pglite` dep. Add a `beforeAll`/`beforeEach` matrix in the DB-gated tests so the suite runs under both drivers.
      Success criteria: `npm test` (default Postgres) and `DB_DRIVER=pglite npm test` both pass. No route/handler code changes.
