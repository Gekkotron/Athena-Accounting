# Empty / loading / error state audit

One-line inventory of what each page renders in the three "no happy path"
states, and what changed during the public-launch trust-polish pass. Any
shared building blocks live in `frontend/src/components/StateBlocks.tsx`
(`EmptyState`, `ErrorState`, `LoadingBlock`) and reuse the existing
`ink-*` / `sage-*` / `clay-*` tokens.

Ordered by visibility.

## Dashboard (`pages/Dashboard/index.tsx`)

- **Empty** — accounts query returns `[]` → onboarding block with a CTA to
  `/accounts` (was: blank Hero + "—").
- **Loading** — root queries pending → Hero renders "—" placeholder;
  BalanceChart section shows `LoadingBlock` (was: raw `animate-pulse` div).
  InsightsSection/SankeySection also swapped to `LoadingBlock`.
- **Error** — accounts or balance query fails → `ErrorState` at the top
  with retry that refetches all root queries; downstream sections
  suppressed. InsightsSection and SankeySection also route their per-panel
  errors through `ErrorState`.

## Transactions (`pages/Transactions/index.tsx`)

- **Empty** — `TransactionsTable` already renders "Aucune transaction." in
  its tbody. Preserved.
- **Loading** — table already renders "Chargement…" in its tbody.
  Preserved.
- **Error** — was silent: table stayed empty after fetch failure. Now
  wraps the table in `ErrorState` with a retry when `txQ.isError`.
  Mutation errors (delete/bulk delete/checkpoint/bulk-categorize) already
  had inline banners.

## Accounts (`pages/Accounts/index.tsx`)

- **Empty** — "Aucun compte pour l'instant." block already existed.
  Preserved.
- **Loading** — was: implicit "empty state" while the query was pending.
  Now: `LoadingBlock`.
- **Error** — was: same implicit empty. Now: `ErrorState` with retry.

## Budgets (`pages/Budgets/Caps.tsx`, `pages/Budgets/Envelopes/Envelopes.tsx`)

- **Empty** — both tabs already had an onboarding empty-state ("Aucun
  budget défini." / "Aucune enveloppe pour ce mois"). Preserved.
- **Loading** — both previously fell through to the empty state while
  `report`/`reportQ` was pending. Now render `LoadingBlock`.
- **Error** — both previously stayed on the empty state on fetch failure.
  Now route through `ErrorState` with retry.

## Rules (`pages/Rules/index.tsx`)

- **Empty** — the grouped view lists all categories with a "+ ajouter"
  affordance, so a fresh install already reads as a directory rather than
  a blank page. Preserved.
- **Loading** — was: implicit empty (`rules = []`) while queries pending.
  Now: `LoadingBlock`.
- **Error** — was: silent empty. Now: `ErrorState` refetching both
  `rulesQ` and `catQ`.

## Data — Duplicates & PDF Templates (`pages/Imports/DuplicatesPanel.tsx`, `pages/Imports/PdfTemplatesPanel.tsx`)

- **Empty** — both panels already rendered a friendly empty message.
  Preserved.
- **Loading** — DuplicatesPanel had no loading branch (fell through to
  empty); PdfTemplatesPanel had a raw `animate-pulse` block. Both now
  render `LoadingBlock`.
- **Error** — new `ErrorState` with retry on `dupsQ.isError` and
  `templatesQ.isError`. `BackupPanel` is mutation-only and already
  surfaces `ApiError.message` inline via `backupError`.

## Imports (`pages/Data/Imports.tsx`)

- **Empty** — `FileImportsList` already renders "Aucun import pour
  l'instant." in its tbody. Preserved.
- **Loading** — was: empty table while the query was pending. Now:
  `LoadingBlock` above the section.
- **Error** — was: silent empty on failure. Now: `ErrorState` with retry.
  `UploadForm` mutation errors are already surfaced inline.

## Settings (`pages/Settings.tsx`)

- **Empty** — not applicable (settings always exist; fallback `DEFAULTS`
  applied by `useSettings`).
- **Loading** — was: raw `animate-pulse` block. Now: `LoadingBlock`.
  `data-testid="settings-skeleton"` preserved for existing tests.
- **Error** — mutation errors already surfaced inline via
  `t('settings.errors.saveFailed')`. The initial fetch falls back to
  `DEFAULTS`, so a background failure never blocks the page.

## Profilee (`pages/Profilee.tsx`)

- **Empty / Loading** — not applicable: the page is a form seeded from
  the `me` cache (populated at app boot by the auth probe).
- **Error** — mutation errors already surfaced inline via `ApiError`
  message in a `clay-*` block. Success banner in `sage-*`.

## Login (`pages/Login.tsx`)

- **Empty** — not applicable (blank form is the intended initial state).
- **Loading** — the `onboarding-status` query falls back to
  `needsOnboarding = false` while pending, so the form is rendered
  immediately with the login-mode default. No skeleton needed.
- **Error** — login/create mutations surface `ApiError.message` inline in
  a `clay-*` block; the onboarding-status probe silently falls back on
  failure (login mode is safe as a default).

## Non-scope pages touched by shared plumbing

- `pages/Rules/Tri.tsx`, `pages/Rules/Categories.tsx`, `pages/Accounts/Patterns.tsx`,
  and the `PdfTemplateWizard` were not part of the scope for this pass;
  they remain unchanged and can be audited in a follow-up sweep if their
  fetch surface warrants it.
