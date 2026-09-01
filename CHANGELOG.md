# Changelog

All notable versions of Athena Accounting are listed here.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [SemVer](https://semver.org/) — `MAJOR.MINOR.PATCH`.

Each section carries the version and the date in `YYYY-MM-DD` format.
The `.github/workflows/release.yml` workflow extracts the section matching
the `vX.Y.Z` tag and publishes it as the GitHub release body — keep this
exact format (`## [X.Y.Z] - YYYY-MM-DD`).

## [Unreleased]

### Added
- **Notifications**: alerts for big transactions, low balances, envelope
  overspend, and bank-sync failures. Configurable per account with a
  privacy toggle. See [docs/users/notifications.md](docs/users/notifications.md).

### Fixed
- **Sankey**: the breakdown tooltip now flips above the pointer when the
  hovered node sits near the bottom of the chart, so it can no longer be
  clipped by the wrapper's implicit vertical overflow.

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
