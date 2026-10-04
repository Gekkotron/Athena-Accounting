# Changelog

All notable versions of Athena Accounting are listed here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [SemVer](https://semver.org/) — `MAJOR.MINOR.PATCH`.

Each section carries the version and the date in `YYYY-MM-DD` format.
The `.github/workflows/release.yml` workflow extracts the section matching
the `vX.Y.Z` tag and publishes it as the GitHub release body — keep this
exact format (`## [X.Y.Z] - YYYY-MM-DD`).

## [Unreleased]

## [1.0.0-rc.7] - 2026-10-04

Re-cut of rc.6 — same product; the rc.6 Release workflow got past the
sidecar smoke step but then failed on the Linux desktop job when
`linuxdeploy` (shipped as an AppImage) couldn't run on the `ubuntu-24.04`
runner because Noble ships libfuse3 and no libfuse2. rc.7 ships the
same product plus the AppImage-bundler fix.

### Fixed
- **Release pipeline — Linux AppImage on Ubuntu 24.04.** The "Build
  Tauri app" step now exports `APPIMAGE_EXTRACT_AND_RUN=1`, which
  tells `linuxdeploy` to extract itself to a tmpdir and execute
  without needing FUSE. Harmless on macOS / Windows (no AppImage
  invoked there). The symptom this cures is the opaque
  `failed to run linuxdeploy` message Tauri emits when linuxdeploy
  crashes at AppImage mount time.

## [1.0.0-rc.6] - 2026-10-04

Re-cut of rc.5 — the rc.5 release workflow failed on every desktop OS
at the new "Smoke-test bundled sidecar" step and never published a
GitHub release. rc.6 ships the same product plus the release-pipeline
fix below and the post-tag polish listed under *Fixed*.

### Fixed
- **Release pipeline — deterministic sidecar deps.** `build-sidecar.mjs`
  now installs the sidecar from `backend/package-lock.json` via `npm ci`
  instead of lockfile-less `npm install`, so a transitive major-bump can
  no longer silently brick a release build. `content-disposition` is
  pinned to `^2.0.1` in `backend/package.json` as an explicit sentinel
  against the 3.x ESM-only flip that broke rc.5 (`@fastify/static@10.x`
  still CJS-requires it).
- **Release pipeline — smoke diagnostics.** `smoke-encryption.sh` now
  dumps the sidecar's log on the early-exit path too, so a CJS/ESM
  module-load crash is visible in CI directly instead of surfacing as
  a blank "sidecar exited before printing ATHENA_PORT".
- **Browser-only demo — mixed locale.** Category names and the demo
  banner were hard-coded in French and leaked into the English demo;
  both now key off `useLang()` with a shared `i18n-categories.ts` map.
  Playwright locale pinned to `fr-FR` so the French assertion set
  stays stable across runners.
- **Dashboard — Sankey panel edge.** Added an 8-px horizontal inset
  so end stubs no longer kiss the panel border on narrow widths.

### Changed
- **README above-the-fold** — tightened the first screen for the
  r/selfhosted announcement (full-Sankey hero, Sponsor badge next to
  the install trio, concise value prop).

## [1.0.0-rc.5] - 2026-10-02

### Added
- **TOTP 2FA**: optional second factor on sign-in using any RFC 6238
  authenticator app (Google Authenticator, Aegis, 1Password, …). Enroll
  from *Paramètres → Sécurité* with a QR code and a one-time verification;
  recovery codes are generated once at setup for lost-device access. The
  login flow steps up to a code prompt only when 2FA is active for the
  account. User documentation in EN + FR.
- **Rule-driven auto-splits**: a categorization rule can now split a
  matched transaction into N parts (percent or fixed amount per leg) and
  emit them atomically on import, cutting the manual split-editor dance
  for recurring multi-category spends (groceries + household, …). New
  *Split editor* in the rule form, with validation that legs sum to the
  original amount. User documentation in EN + FR.
- **Notifications**: alerts for big transactions, low balances, envelope
  overspend, and bank-sync failures. Configurable per account with a
  privacy toggle. Alerts can also be routed to **WhatsApp via CallMeBot**
  as a server-side side-channel (fire-and-forget request, same privacy
  masks as the toast and browser channels), with a rolling one-minute
  rate limit (`Max notifications per minute`, `0` = no limit) that
  applies to the WhatsApp channel only. The *Notification du navigateur*
  tip is reframed as a generic browser-permission guide (Chrome HTTP flag
  kept as a side note). See [docs/users/notifications.md](docs/users/notifications.md).
- **Budgets paradigm picker**: `/budgets` now lands on a two-tile picker
  (*Caps* vs *Envelopes*) that explains each approach instead of silently
  redirecting. Sub-routes still deep-link straight to a view. Caps auto-
  expands the "unbudgeted categories" suggestions on a first visit, and
  the Envelopes empty state now describes how envelopes materialize
  (from categorized transactions) instead of a mysterious CTA.
- **Dashboard — "All available accounts" scope**: new scope on the
  balance chart that includes every open account and *steps up* as
  blocked-money lock periods expire (so the curve reflects usable
  liquidity over time). Excludes investment accounts.
- **Accounts — closing date + "Fermé" badge**: a *Date de fermeture*
  field in the edit form flags an account as closed; the card shows a
  small *Closed* badge next to the currency. Purely visual — balance
  math, bank sync, and lists are unaffected.

### Changed
- **Forecast — Recurrent tab** unified on the average-based projection,
  dropping the old recurring-detector output path for a single
  explainable model. The Recurrent and Averages tabs now share display
  currency and midnight-boundary refresh behaviour.
- **Réglages icon** in the sidebar swapped from a gear SVG to a sliders
  icon, matching the "settings as adjustments" metaphor used throughout
  the app.

### Fixed
- **Dashboard chart**: the "All available accounts" curve correctly
  excludes investment accounts from the usable-liquidity line.
- **Insights / Forecast**: the Insights and Forecast cards now refresh
  across the midnight boundary and re-key on `displayCurrency` so a
  currency switch in Settings propagates without a manual reload.
- **Dates across the app**: UTC-based "today" defaults replaced with
  local-calendar helpers (dashboard windows, duplicates cutoff,
  notifications opening-date auto-heal, transaction-modal parse). A
  late-evening entry in a positive-UTC-offset timezone no longer slips
  into "tomorrow" on the chart.
- **Rules**: labels on `RuleCreateForm` wired up via `htmlFor`/`id` so
  screen readers announce the matching field.

### Security
- **Session secret**: every desktop install now generates a cryptographic
  random `SESSION_SECRET` at first launch (with a one-shot migration for
  pre-existing installs), replacing the hardcoded default. Prevents
  cross-install session forgery.
- **TOTP replay guard**: a verified code is marked used for its ±1
  acceptance window so a replay inside the 90 s overlap is rejected.
- **Login timing**: the user and TOTP SELECTs now run in parallel so the
  response time no longer leaks whether 2FA is enabled on an account.
- **Recovery codes**: verification uses constant-time comparison to
  close a theoretical timing side-channel on the lookup path.
- **Debug routes**: the `/__debug/current-code` test helper is now dual-
  gated on `NODE_ENV=test` **and** `ATHENA_TEST_ROUTES=1`, so a
  misconfigured prod deploy can't accidentally expose it.

### Performance
- **Frontend startup**: route-level `React.lazy` split brings the entry
  bundle from **477 kB → 58 kB** — first paint on cold caches is
  measurably snappier, and heavy routes (Imports, Rules, Settings)
  stream in on demand.
- **Reference-data queries**: `staleTime` + `select` sweep across the
  reference-data hooks removes the thrash on every route change (same
  data was being refetched + rerendered dozens of times per minute).
- **Transactions list**: row-level `useMemo` on derived deps + wrapping
  `TransactionRow` in `React.memo` cuts recompute on large pages.
- **Server compression**: `@fastify/compress` now serves brotli + gzip
  responses — API payloads are 60–80% smaller over the wire.
- **Attachments**: upload path streams the request body straight to disk
  instead of the previous "insert row, then UPDATE with the file"
  dance — one round-trip, half the DB churn.
- **Imports — list endpoint**: cursor pagination on `GET /api/imports`
  with a *Load more* UI, and a collapsed N+1 that was issuing one query
  per returned row.
- **Imports — post-commit**: envelope and preference fan-out batched;
  bulk `INSERT` sweep for restore + import write paths; categorization
  UPDATE collapsed into a single statement per batch.
- **Duplicates detection**: clustering pushed into SQL with a bounded
  time window — on large ledgers the panel loads in a second instead of
  stalling on a client-side pass.
- **Tri assignments**: `/api/tri/assign` wrapped in a single transaction
  and batched instead of one write per row.
- **Recurring detection**: `runRecurringDetection` batches its writes.
- **Recategorize**: split-emit fan-out collapsed into 3 bulk statements.

### Internal
- Frontend split sweep against the ESLint `max-lines 300` cap:
  `Accounts`, `Rules`, `AccountForm`, `Categories`, `RemoteBackupCard`,
  `Tri`, `Plafonds`, `SettingsBankSync`, `TransactionModal` all broken
  into focused submodules without behaviour changes.
- `runImport` split into five focused modules; `err: unknown` + narrowing
  helpers in the three `catch` blocks.
- Full-stack Playwright suite re-aligned after the hub reshuffle
  (`/imports → /data/imports`, `/rules → /rules/list`) and the TOTP /
  rate-limit changes.
- Backend/frontend DB-integration suites caught up to prod schema
  shape; backend ESLint back to zero warnings, frontend swept of nine
  stale warnings.
- `AUTH_RATE_LIMIT_MAX` override exposed for e2e; demo mode gates
  `/api/notifications/stream` behind `VITE_DEMO`.
- User docs: Rules → auto-splits (EN + FR), Auth → TOTP 2FA (EN + FR),
  Budgets walkthrough updated for the paradigm picker, Accounts for the
  Closed badge, Notifications for CallMeBot.

## [1.0.0-rc.4] - 2026-08-12

### Added
- **Remote backup** (new): scheduled shipment of an encrypted ledger dump
  to a local folder, a **WebDAV** server, or an **FTP** box (with a
  native passive-mode client, primarily tested against Freebox). A
  *Settings → Remote backup* card lets you configure the destination,
  pick the daily hour, trigger an immediate backup, and inspect the
  status of the last run. Secrets (password, passphrase) are encrypted
  at rest with AES-256-GCM; the scheduler can be disabled via
  `BACKUP_AUTO=0`. When re-saving a destination, leaving the password
  field blank keeps the stored secret. User documentation in EN + FR,
  with a dedicated Freebox FTP guide.
- **Sankey**: hovering any root (Expenses / Income) now expands the
  breakdown into subcategories in the tooltip, not just the "Others"
  tail. Shared palette so colors stay consistent between a root and its
  children.
- **Footer bar**: direct link to the documentation, with an anchor
  computed from the active route (for example, on *Rules*, the link
  points straight to the Rules section). The footer *Athena* logo
  routes back to the dashboard.

### Changed
- **Reports — `internal transfer` inheritance**: when a parent category
  is flagged as an internal transfer (e.g. *Savings*), its children
  (Crypto, PEA, …) are now treated as such without ticking each one.
  The `/api/reports/categories` API returns the effective flag (own OR
  the parent's, 2-level hierarchy max), which the *Averages* tiles, the
  Insights card, the per-category donut, and the Sankey consume as-is —
  no more leakage into expense / income totals.

### Fixed
- Bank sync: a server restart after today's scheduled sync no longer
  triggers a second automatic sync 5 minutes after boot. The scheduler
  now primes its anti-duplicate guard from the last `lastSyncedAt`
  persisted in the database — if an account has already been synced
  today, the post-boot catch-up is skipped. The catch-up after an
  overnight server shutdown is unchanged (the first sync of an account
  never synced before still fires at startup).
- Charts: the "Last N months" periods now cover N **full calendar
  months** rather than a rolling window in fixed days; a partial current
  month no longer skews comparisons.
- Charts: the per-category donut excludes categories flagged as
  *internal transfer*, which were artificially inflating the pie.
- Insights: the "price hike" card only considers expense series (income
  has no "climbing price").
- Lock screen: the *Sign out* button on the overlay now actually pulls
  the overlay along with it (clean redirect, no more orphan locked
  screen after sign-out).
- Lock screen: a successful sign-in clears any stale lock flag left
  over from a previous session.
- Rules: the delete cross stays visible on rule chips (flat view and
  per-category view), for consistent affordance with the other chips.
- Sankey: more air between ribbons (vertical spacing bumped from 6 to
  10 px) to lift the crowded-nodes feel in the expenses column.
- Sankey: labels now "breathe" inside the colored ribbons — the minimum
  node height goes from 28 to 40 px, giving 7 px of top/bottom margin
  around the name and amount (versus 1 px before) on small categories
  that used to touch the ribbon edges.

## [1.0.0-rc.3] - 2026-08-03

### Added
- **Lock screen**: after 5 minutes of inactivity (or a click on the eye
  button), the app locks behind a server-verified password prompt — it
  replaces the old privacy mode which only blurred amounts and unblurred
  itself without authentication. The current page, filters, and in-flight
  drafts survive the lock; a reload (F5) or app relaunch starts locked.
  Keyboard navigation is trapped inside the dialog (focus can't escape
  to the blurred app).
- Desktop: optional **lock password**, set in *Settings → Lock password*
  (set / change / remove). As long as no password is set, locking stays
  inactive. Recovery procedure documented in *Security and privacy* in
  case of a forgotten password.
- Updated *Security and privacy* documentation (FR + EN): how locking
  works, honest threat model (protects against the passer-by at the
  keyboard, not against disk access), desktop recovery.

### Changed
- The eye button now **locks immediately** — no more masking/revealing
  without authentication; masked now means locked.
- Online demo: locking disabled (no password to type in).

### Fixed
- Backend tests: the full PGlite suite (`RUN_DB_TESTS=1`) goes back to
  green — the environment used to freeze on first import and ignored
  the `AUTH_MODE` overrides from test files (test-only refresh
  mechanism), and PGlite emits SQL code `23001` where Postgres emits
  `23503` for deleting a still-referenced account (both now return the
  expected 409).
- API: the password verification endpoint can no longer return a 500
  when called through the internal MCP channel (explicit guard, clean
  401).

## [1.0.0-rc.2] - 2026-08-03

First **unified** release: a single `vX.Y.Z` tag now publishes one
release page that carries the desktop installers (`.dmg` macOS,
`.AppImage` Linux, `.exe` Windows) as attachments **and** the GHCR
Docker images. The separate `v*-desktop*` tag channel is retired; the
repo's "Latest" badge will always point to the newest stable version.

### Added
- Bank sync: **configurable fetch hour** directly in the *Data → Bank
  sync* tab (per-user setting, 02:00 default). The scheduler applies a
  catch-up at startup: a server left on continuously syncs at the
  chosen hour, a desktop app closed overnight catches up on its next
  launch.
- Bank sync: display of the **last** and **next** automatic fetch in
  the tab.
- Bank sync: **warning banner** when a consent expires within 14 days —
  in addition to the amber pill already shown on each connection — so
  you can reconnect the bank before the interruption.

### Fixed
- Transactions: checkpoint pins and the drift warning no longer show
  up when a search or a filter (category, amount, source file) truncates
  the visible days. The "end of day" of the filtered view could be a
  mid-day row: false drift reported, and a pin placed there would have
  frozen an intermediate balance. The BALANCE column is still shown —
  its values are computed server-side over the full history and stay
  correct under any filter.
- Docker images: build stages pinned to `$BUILDPLATFORM` — multi-arch
  publishing used to spend 90+ minutes emulating the frontend build
  under QEMU; it now takes ~2 minutes.
- Backend tests: `npx vitest run` works again without any environment
  variable (session secret and PGlite driver defaulted in the suite
  setup).

### Changed
- Unified release workflow: the desktop matrix (sidecar build, bundle
  smoke, Tauri build, installed-app smoke) lives in `release.yml`;
  publishing is gated on **all** artifacts.
- Desktop versioning aligned with the tag: `tauri.conf.json` now
  carries the bare `X.Y.Z` (no more `-desktop-rcN` versions).

## [1.0.0-rc.1] - 2026-07-31

First release candidate of the family server (Docker). Desktop
binaries follow their own tag channel (`v*-desktop*`).

### Added
- Optional bank sync via Enable Banking (personal credentials,
  read-only): *Data → Bank sync* tab, nightly sync disable-able
  (`BANK_SYNC_AUTO=0`), same pipeline as file imports (deduplication,
  rules, transfers, recurrences). See `docs/users/bank-sync.md`.
- Dashboard: balance projection based on per-account monthly averages
  (a "sawtooth" curve stitched without vertical jumps).
- Transactions: keyboard shortcuts on the list (navigation, edit,
  delete, search), 5-second undo window after a single or bulk delete,
  amber warning on divergent checkpoints, editable checkpoint date.
- Rules: "Transfers" tab to manage the keywords used to detect internal
  transfers.
- Accounts: help tooltip with examples on the Type field.
- Publishing a GitHub release from a `vX.Y.Z` tag
  (`.github/workflows/release.yml`), with notes automatically extracted
  from this file.
- Multi-arch Docker images (amd64 + arm64) published to GHCR on every
  release, and `docker-compose.release.yml` to spin up the stack
  without a local build (version pinnable via `ATHENA_VERSION`).
- End-to-end tests: full-stack Playwright suite (real backend +
  Postgres) in CI, and installed-app smoke (dmg/AppImage/NSIS) in the
  desktop release workflow.

### Fixed
- Backend tests in CI: test-file serialization
  (`fileParallelism: false`) — the files share the same Postgres
  database and several were running global `db.delete(users|accounts)`,
  which wiped the other files' fixtures in parallel and broke ~65
  tests with FK violations.
- "Today" fields computed against the local calendar day rather than
  UTC.
- Import preview: table kept in date order in the presence of
  duplicates.
- Account type translated on the Accounts page card.

### Changed
- Node 20 → 22 in the CI workflows and the base Docker images.

## [1.0.0-desktop-rc1] - 2026-07-23

Second desktop pre-release after `v1.0.0-desktop-beta1`. See
`docs/RELEASES/v1.0.0-desktop-rc1.md` for the full list.

### Security
- Non-root container + nginx security headers.
- `/metrics` option gated by a bearer token for Prometheus on the LAN.
- Rejection of ReDoS-risk regex patterns when creating a rule.
- Per-`userId` scoping on the Rules endpoints (IDOR).

### Fixed
- Accounting corrections: `transaction + splits` atomicity,
  transactional `unlink + delete`, race-safe `envelopes.bumpBy`,
  timeseries clipped to the requested period, account merge refused
  when `opening_date` differs.
- FR decimals: `parseDecimal` on Accounts inputs, no more `×100` in
  CSV import under comma mode.
- Docusaurus: `LedgerStrip` moved out of `pages/` so it isn't routed
  as a page.

### Added
- 8 new guided tours (envelopes, rules/list, …).
- Transactions section in Settings with a default account,
  preselected in new transactions.
- "Pin" toggle replacing the checkpoint checkbox, floating info-tip
  explaining the BALANCE column.

### Changed
- ESLint 9 enabled with a 300-line cap per source file, run in CI
  before the type-check.
- `Layout.tsx` and the Transactions page split into focused submodules;
  hooks extracted (`useAccountsReorder`, `useCategoriesDrag`,
  `useDuplicatesMutations`, `useBalanceChartInteractions`, …).
- Shared API contracts grouped under `shared/api-contracts`;
  `parseId`/`isPgError` centralized + global error handler.
