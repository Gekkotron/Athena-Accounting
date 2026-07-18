# Plan

## Notes

Not parsed by the orchestrator — informational context for the human and the
planner. See `CLAUDE.md` for the parser contract.

### Docker + Tauri dual-track — foundational refactor

Goal: ship a Tauri desktop app (Mac/Windows/Linux) alongside the current Docker stack, from the same codebase. Docker path stays the family-server story; Tauri path is the "no install, no Docker" solo-user story. **Packaging pivoted from single-binary to directory-based sidecar** (2026-07-17) — the native-deps tree (sharp+libvips, @napi-rs/canvas, argon2, PGlite WASM, pdfjs worker, tesseract) is hostile to single-binary bundlers, and Tauri's sidecar mechanism accepts a folder just as happily.

### Cross-cutting risks to flag before starting

- **PGlite maturity** — 0.x. Extensions and some advanced JSON features unsupported. Athena's schema doesn't use those, but each task above should be verified rather than assumed.
- **Tauri code-signing on macOS** — needs an Apple Developer account ($99/yr) to avoid Gatekeeper warnings. Not blocking; document the workaround for now.
- **Bundle size** — directory-based sidecar is ~50–80 MB per platform (Node runtime ~30 MB + sharp/libvips ~15 MB + canvas/PGlite/pdfjs/tesseract adding more). Larger than a single stripped binary, but reliable. Note in release notes.
- **Cross-arch Node binaries** — macOS-arm64 hosts building macOS-x64 (or vice versa) need `unofficial-builds.nodejs.org` or a matching runner in CI. The packaging workflow's matrix strategy handles this automatically.

## Backlog




- [ ] Empty / loading / error state audit across all pages
      Systematically audit each page under `frontend/src/pages/` for empty, loading, and error states. Goal: no page can present a bare skeleton or a raw error object; every state has an intentional design. Public-launch trust polish.
      Scope (visibility-ordered): Dashboard → Transactions → Accounts → Budgets → Rules → Data → Imports → Settings → Profile → Login.
      For each page, cover the three states: **Empty** (no data yet) — friendly onboarding block with a CTA, not a blank page; **Loading** (fetch in-flight) — reuse existing skeleton components (`grep -r 'Skeleton' frontend/src/components/`) or a spinner block, no CLS; **Error** (fetch failed, network offline, mutation rejected) — actionable error block with a retry, not a raw stack trace or `[object Object]`.
      Do NOT introduce new UI patterns or tokens. Reuse existing `ink-*`, `sage-*`, `clay-*` classes and existing component primitives. Do NOT touch the demo-mode adapter (separate task).
      Deliverables: one commit series on `main` per page (per project convention — commits use `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`); plus `docs/dev/state-audit.md` with one short entry per page recording what was found and what changed.
      Success criteria: (a) every page above has confirmed empty, loading, and error states via a manual walkthrough on the dev server; (b) `docs/dev/state-audit.md` has one entry per page; (c) no page renders a raw error object or a bare skeleton for more than ~300 ms.

- [ ] User walkthroughs — screenshotted guides for core flows
      Add step-by-step, screenshotted user guides for Athena's four core flows under `docs/users/walkthroughs/`. Aim: convert README/docs-site visitors into installs.
      Flows (one file each): `import-a-statement.md` (import a PDF/CSV bank statement, resolve categorisation prompts, verify balance checkpoint); `categorise-transactions.md` (bulk vs single categorisation, creating a rule from a transaction, transfer rules); `set-a-budget.md` (creating a budget for a category, choosing period, seeing progress on Dashboard); `view-reports.md` (Dashboard tour — Sankey, Insights, monthly overview — filtering by account/date range).
      Format per file: Docusaurus frontmatter (`title`, `sidebar_position`); 3–6 short numbered steps, each with one screenshot (PNG under `docs/users/walkthroughs/img/`) captured against the demo build (task above) or the dev server with seed data; screenshots use the French UI (project's primary language); ends with a "Next steps" pointer to a related walkthrough.
      Wire into the Docusaurus sidebar (`website/sidebars.js` or equivalent) under a new "Walkthroughs" category ordered above "Reference".
      Do NOT rewrite existing docs. Do NOT translate to English yet — French only for v1.
      Success criteria: (a) all four files exist with real screenshots (not placeholders); (b) each renders on the local Docusaurus dev server; (c) the sidebar shows the new "Walkthroughs" category with four entries; (d) `grep -rE 'Lorem|TODO|placeholder' docs/users/walkthroughs/` returns nothing.

- [ ] Backup/restore drill + documented recovery playbook
      Prove and document that the existing backup/restore path (`backend/src/http/routes/backup/` + `frontend/src/pages/Imports/BackupPanel.tsx`) round-trips a real dataset without loss. Ship the drill + a public recovery playbook.
      Drill (Tauri path primary; Docker path best-effort — skip cleanly if no Docker runtime is available in the executor's environment): (1) Populate a dev instance with ≥200 transactions across 2 accounts, 3 budgets, 5 rules, 1 balance checkpoint. Capture a state hash = `(row counts per table) + SHA-256 of "last 10 transactions ordered by id, JSON-serialised"`. (2) Export via the UI (Settings → Imports → BackupPanel → Export). Save the file (size + SHA-256). (3) Wipe: delete the PGlite file (Tauri) or drop the Docker Postgres volume, re-run migrations, confirm the app boots to onboarding. (4) Restore via the UI (BackupPanel → Restore) using the exported file. (5) Verify: state hash must match step 1; Dashboard / Transactions / Budgets / Rules render identically (side-by-side screenshots).
      Deliverables: `docs/users/backup-recovery.md` (French) — where the file lives per OS, how to schedule regular exports, step-by-step restore, common pitfalls, and a **known limitation** callout that export files are cleartext JSON with no at-rest encryption yet; `docs/dev/backup-drill-report.md` — the drill report itself: date, environments tested, state hashes, timing, findings; any bug uncovered becomes its own new backlog item (do NOT fix bugs in this task); link `docs/users/backup-recovery.md` from `docs/users/security-and-privacy.md` and from the `README.md` bottom section.
      Do NOT change the backup/restore code paths in this task. Verification + documentation only.
      Success criteria: (a) drill executed on Tauri path with matching state hash pre-wipe / post-restore; (b) both docs files exist; (c) side-by-side screenshots under `docs/dev/img/backup-drill/`; (d) `docs/users/backup-recovery.md` linked from at least two other pages.

## In progress

- [ ] Browser-only demo mode — execute existing plan     <!-- blocked: 10-task plan (~30 API handlers incl. compound reports, unit + Playwright tests, GH Pages deploy job, banner, docs integration) is a multi-day human-supervised effort; not safely completable end-to-end in one headless dispatch when success requires every checkbox ticked and the constraint is direct-commit-to-main. Recommend splitting into per-task backlog items. -->
      The implementation plan already exists at `docs/superpowers/plans/2026-07-18-browser-only-demo.md`. Execute it end-to-end.
      Use `superpowers:subagent-driven-development` (or `superpowers:executing-plans` as fallback) — the plan is structured with `- [ ]` checkboxes across 10 tasks (adapter scaffolding, seed data, read/write handlers, stubbed endpoints for unsupported features, banner + reset, docs-site integration, CI deploy to `gh-pages` under `/demo/`, tests, ship).
      Global constraints (repeated for the headless worker): frontend-only, no backend changes; direct commits on `main`, push only when the plan is fully done; every commit uses `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`; seed data is public-safe (no real names, IBANs, or emails; plausible French-vendor fakes); French UI stays primary.
      Success criteria: (a) `VITE_DEMO=1 npm run build` produces `frontend/dist-demo/`; (b) the GH Actions job publishes to `gh-pages` under `/demo/` alongside the docs site; (c) `https://gekkotron.github.io/Athena-Accounting/demo/` boots and lets a visitor navigate dashboard, transactions, and budgets against the seed with no network calls beyond static assets; (d) every `- [ ]` checkbox in the plan is ticked to `- [x]`.
## Done

- [x] Public-launch essentials pack — LICENSE, SECURITY, CONTRIBUTING, CoC, templates
      Add the minimum "trustable public repo" file set at repo root and under `.github/`. All attribution to `Gekkotron` (email `60887050+Gekkotron@users.noreply.github.com`); no real name anywhere in any added file.
      Files to create: `LICENSE` (MIT, `Copyright (c) 2026 Gekkotron`); `SECURITY.md` (how to report vulnerabilities via the noreply GitHub email; 90-day coordinated-disclosure window; explicit note that this is a solo-maintainer project with no SLA); `CONTRIBUTING.md` (issue filing guidance; PR conventions matching the existing commit format `type(scope): subject` — see `git log --oneline -20` for examples; dev-setup pointer to `docs/users/getting-started.md`; maintainer-bandwidth expectations); `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 verbatim; fetch canonical text and substitute `[INSERT CONTACT METHOD]` with the noreply email); `.github/ISSUE_TEMPLATE/bug_report.md` (front-matter `name`, `about`, `labels: bug`; body sections: reproduction steps, expected vs actual behavior, environment (OS, Docker vs Desktop path, release version), logs); `.github/ISSUE_TEMPLATE/feature_request.md` (front-matter `name`, `about`, `labels: enhancement`; body sections: problem statement, proposed solution, why now); `.github/PULL_REQUEST_TEMPLATE.md` (summary, test-plan checklist, UI screenshots, breaking-changes flag).
      Update `README.md`: append a bottom section linking `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md`. Do NOT touch the existing header/badges/install section.
      Success criteria: (a) all files exist at correct paths; (b) `grep -RIn '<any real-name variant>' LICENSE SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md` returns nothing; (c) `LICENSE` copyright line is exactly `Copyright (c) 2026 Gekkotron`; (d) `README.md` bottom section links all three community docs.

- [x] Cut `v1.0.0-desktop-beta1` — finish + publish release
      Prior state (verified 2026-07-18): version bumps in `desktop/src-tauri/Cargo.toml` + `tauri.conf.json` are done; `docs/RELEASES/v1.0.0-desktop-beta1.md` exists; annotated tag `v1.0.0-desktop-beta1` is on `origin` pointing at commit `9edc8b4`; both workflow triggers are correct (`desktop-release.yml` uses `v*-desktop*`, `release.yml` excludes `!v*-desktop*`); the latest `desktop-release` run at that tag (`29638068094`) is green with all three "Attach to draft GitHub Release" steps succeeding. Despite that, `gh api repos/Gekkotron/Athena-Accounting/releases` returns `[]` — no release exists. What remains is figuring out where the draft went and finishing publication.
      Investigate: pull the raw logs of run `29638068094` (`gh run view 29638068094 --log`), specifically the "Attach to draft GitHub Release" step for each matrix job, to confirm whether `softprops/action-gh-release@v2` actually created/updated the release or silently no-op'd. Look for the `release_id`, `upload_url`, or `html_url` fields in that step's output.
      If the draft was created and then deleted: re-trigger the workflow via `gh workflow run desktop-release.yml -f tag=v1.0.0-desktop-beta1` (workflow_dispatch input) — this reuses the same tag without re-tagging, and rebuilds artifacts. Do NOT force-retag unless the tag itself is corrupt.
      Once a draft release with three artifacts (`.dmg`, `.AppImage`, `.exe`) exists, promote: `gh release edit v1.0.0-desktop-beta1 --draft=false`.
      Do NOT attempt to launch `.exe` or `.AppImage` from this macOS session — cross-OS install verification is the human-owned checklist under `## Manual checklist` in this file (parser-invisible section) and is expected to complete outside the orchestrator.
      Success criteria: `gh release view v1.0.0-desktop-beta1 --json isDraft,assets` shows `isDraft:false` and three assets (`.dmg`, `.AppImage`, `.exe`).

- [x] Restyle the public docs site to match the app's visual identity
      Target: <https://gekkotron.github.io/Athena-Accounting/> — currently uses the default theme of whatever static-site generator sits behind it. Make it feel like a first-party companion to the app.
      Investigate first: identify the generator by checking for `website/`, `docs-site/`, a top-level `docusaurus.config.*`, `mkdocs.yml`, `astro.config.*`, `vitepress.config.*`, `_config.yml` (Jekyll), or a `.github/workflows/*pages*.yml` that deploys `gh-pages` — do NOT guess; grep and report what you found.
      Extract the app's design tokens from the frontend: read `frontend/tailwind.config.*` (colors, fonts, radii, shadows), the primary logo file (likely `website/static/img/logo.svg` per Task 8's icon prep, or `frontend/public/logo.*`), the favicon, and any CSS variables in `frontend/src/index.css` or equivalent. Note the exact hex values, font stack, and asset paths — the docs site will reuse these verbatim.
      Apply to the docs site: brand color as the accent (links, headings, active nav), the same font stack (self-host webfonts under `static/fonts/` if the site is offline-friendly, or use the CDN the frontend uses), the same favicon and header logo, a matching dark-mode palette that mirrors the app's, and inline code / code-block styling that matches the app's monospace choice.
      Do NOT rewrite content — this is style-only. Any existing pages keep their markdown untouched; only the theme layer (CSS, config, layout components) changes.
      Preview locally with the generator's dev server, then push. If the deploy is on `gh-pages` via workflow, verify the workflow still runs green and the deployed site shows the new theme within a couple of minutes.
      Success criteria: (a) side-by-side screenshot comparison of app landing page and docs landing page shows matching brand color, logo placement, typography, favicon, and dark-mode support; (b) generator's build passes locally and in CI; (c) no content regressions (all existing docs pages still render).

- [x] Docs
      `docs/users/desktop-install.md`: download links, first-run flow, where data lives per OS, how to back up.
      Update `docs/users/getting-started.md`: two-path fork at the top — "Family server (Docker)" vs "Solo user (Desktop)". Neither disparages the other.
      Update `README.md`: install badges for both paths; the Docker prerequisite disclaimer that currently sits at the top becomes conditional on the Docker path.
      Blog post announcing dual distribution once release lands.

- [x] MCP compatibility check
      The MCP endpoint (`/api/mcp/rpc`) must still be reachable in Tauri mode.
      Tauri binds to `127.0.0.1` on a random port — Claude Desktop, Cursor, etc. need to know that port. Options: (a) ship a Tauri "menu bar" indicator that shows the current port + a "Copy MCP config" button, or (b) write the current port to a well-known file (`${DATA_DIR}/.mcp-port`) that Claude Desktop's config can reference.
      Pick one, implement, verify against real Claude Desktop MCP config.
      Success criteria: installing the Tauri app + configuring Claude Desktop's MCP settings from the app's provided config → Claude successfully calls an Athena MCP tool.

- [x] Packaging workflow + CI
      GH Actions workflow `.github/workflows/desktop-release.yml`. Trigger: tag push matching `v*-desktop`.
      Matrix `macos-latest`, `ubuntu-latest`, `windows-latest`. Each job runs `desktop/scripts/build-sidecar.sh` for its own platform (produces `desktop/sidecar/` populated with the right Node binary + prebuilds), builds the frontend (`npm run build`), builds the Tauri app (`cargo tauri build`), then uploads `.dmg` / `.AppImage` / `.exe` as GH Release artifacts.
      Skip macOS code-signing initially (users get the "unidentified developer" dialog once; documented workaround). Revisit once we have an Apple Developer account.
      Success criteria: pushing `v1.0.0-desktop-rc1` produces a draft release with three artifacts, each installable on their target OS and each launching the app successfully.

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

## Manual checklist (human, not the orchestrator)

The list below is not parsed by the orchestrator — this `##` header isn't one of the three known section names, so any `- [ ]` items here are invisible to the tick's `firstBacklogTask`. Track completion manually; you own this section.

- [ ] beta1 — verify macOS `.dmg` install + launch, /health returns ok
- [ ] beta1 — verify Linux `.AppImage` install + launch, /health returns ok
- [ ] beta1 — verify Windows `.exe` install + launch, /health returns ok
- [ ] beta1 — after all three verified: post announcement, update release notes with verification section ticked
