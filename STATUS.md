# Status — Athena Accounting

_Last updated: 2026-07-02_

## Live

Self-hosted personal accounting app. Local-only, LAN-reachable. See
[`README.md`](./README.md) for setup.

- CI: <https://github.com/Gekkotron/Athena-Accounting/actions>
- Coverage: <https://codecov.io/gh/Gekkotron/Athena-Accounting>

## Recently landed

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
| Rules.tsx          | ✅ (8)       | ✅    | ✅ (15)    |
| Transactions.tsx   | ⬜           | ⬜    | ⬜         |
| Imports.tsx        | ⬜           | ⬜    | ⬜         |
| backup.ts (backend)| ⬜           | ⬜    | ⬜         |

## Known deferrals

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

## Environment

- Runtime: Node 20 + Postgres 16 via `docker compose up`. LAN-reachable
  on the ports listed in the README.
- CI: GitHub Actions with a Postgres 16 service container.
- Deployment target: self-hosted, no cloud.
