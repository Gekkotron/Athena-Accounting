# Status — Athena Accounting

_Last updated: 2026-07-02_

## Live

Self-hosted personal accounting app. Local-only, LAN-reachable. See
[`README.md`](./README.md) for setup.

- CI: <https://github.com/Gekkotron/Athena-Accounting/actions>
- Coverage: <https://codecov.io/gh/Gekkotron/Athena-Accounting>

## Recently landed

- 2026-07-02 — Imports.tsx split into pages/Imports/ (6 focused files)
  with characterization + unit tests. Fourth interleave iteration.
- 2026-07-02 — Transactions.tsx split into pages/Transactions/ (6 focused
  files) with characterization + unit tests. Third interleave iteration.
- 2026-07-02 — Rules.tsx split into pages/Rules/ (8 focused files) with
  characterization + unit tests. Second interleave iteration; frontend
  harness unchanged (Vitest + RTL + jsdom).
- 2026-07-01 — `pages/Accounts.tsx` split into `pages/Accounts/` (6 focused files)
  with characterization + unit tests. Frontend test harness introduced
  (Vitest + Testing Library + jsdom). First iteration of the split-code
  + add-tests initiative.
- 2026-07-01 — CI + Codecov coverage on backend tests. Migration 0007
  hardened for fresh installs; four pre-existing PDF tests fixed for
  user_id.
- 2026-07-01 — Balance checkpoints per account + drift markers on the
  Dashboard chart, editable inline from the Comptes drawer.

## In flight

Empty. Update this section when starting a new initiative.

## Refactor + tests progress

| File               | Chars. tests | Split | Unit tests |
|--------------------|:------------:|:-----:|:----------:|
| Accounts.tsx       | ✅ (6)       | ✅    | ✅ (~20)   |
| Rules.tsx          | ✅ (8)       | ✅    | ✅ (27)    |
| Transactions.tsx   | ✅ (8)       | ✅    | ✅ (27)    |
| Imports.tsx        | ✅ (7)       | ✅    | ✅ (15)    |
| backup.ts (backend)| ⬜           | ⬜    | ⬜         |

## Known deferrals

- `accountId` dead prop in `pages/Imports/PdfTemplateWizard.tsx`
  (Imports iteration, 2026-07-02): declared in prop type but never read
  by the component or `PdfTemplateBuilder`. Passed as `''` from
  `index.tsx`. Drop from both sides on next touch.
- `Blob.prototype.text` polyfill in
  `pages/Imports/__tests__/BackupPanel.test.tsx` (Imports iteration,
  2026-07-02): guarded, scoped to that file. Promote to
  `src/test/setup.ts` if a second test file needs `File#text()`.
- `onToggleAdvanced` dead prop in `pages/Transactions/FiltersBar.tsx`
  (Transactions iteration, 2026-07-02): introduced by plan; trivial cleanup
  on next touch.
- `RuleCreateForm` `successCount` reset (Rules iteration, 2026-07-02): `useEffect`
  dependency on `successCount` doesn't re-fire when two successive submits return
  the same count (rare edge case). Would need a counter-signal for exact parity.
- Duplicate `note` Zod chain in `backend/src/http/routes/balance-checkpoints.ts`
  (Task 2 review, 2026-07-01). Extract to a shared `noteField` const on the
  next touch of that file.
- UTC-date default in the checkpoint drawer (`new Date().toISOString().slice(0, 10)`
  gives tomorrow's date for late-evening users). Cosmetic.
- `frontend/tsconfig.json` does not include `tests/**` — runtime landmines
  can slip past `tsc --noEmit`. Add a `tsconfig.test.json` on the next CI
  touch.
- CI runs Node 20 in `setup-node@v4`, and GitHub is deprecating the Node 20
  runner. Bump `node-version: '22'` in `.github/workflows/ci.yml` at the
  next CI touch.
- Error-banner `<div>` markup duplicated across `pages/Imports/UploadForm.tsx`
  and `pages/Imports/BackupPanel.tsx` (whole-branch review, 2026-07-02, Finding 4):
  only 2 sites remain after the `pdfError` branch was removed from
  `PdfTemplateWizard.tsx` — not enough duplication yet to justify an
  `<ErrorBanner>` extraction. Revisit on the next touch of the Imports layer.
- `DuplicatesPanel.accountsQ` (whole-branch review, 2026-07-02, Finding 6):
  panel fetches its own `accounts` query rather than receiving it as a prop
  like `FileImportsList` does. Deliberately self-contained — TanStack Query
  dedupes the cache, so there's no extra network cost — not treated as a
  defect. Left as-is.

## Environment

- Runtime: Node 20 + Postgres 16 via `docker compose up`. LAN-reachable
  on the ports listed in the README.
- CI: GitHub Actions with a Postgres 16 service container.
- Deployment target: self-hosted, no cloud.
