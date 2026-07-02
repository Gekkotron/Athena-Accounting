# TODO / Idées

Brainstorming + roadmap pour Athena Accounting. Pas de structure imposée — déplacez
les éléments entre les sections au fur et à mesure que vous décidez quoi faire.

---

## 🧠 Idées (en vrac)

<!-- Tout ce qui passe par la tête, même à demi-formé. Pas obligé que ce soit clair. -->

- Extend bulk-select to the Possibles doublons panel (currently only on the Transactions list — the panel still has per-row and per-group affordances).


- Traduire l'app (fr, en) avec detection de la langue du navigateur

- check if nuextract will be useful https://about.nuextract.ai (self-hosted)

- Update readme with new feature with screenshot

## 📌 Pour plus tard (committed)

<!-- Idées promues, à faire dans les prochaines itérations. Une ligne par item, ajouter
     une courte note si le contexte n'est pas évident. -->

-

## 🚧 En cours

<!-- Ce sur quoi vous travaillez maintenant. Vide la plupart du temps. -->

-

## ✅ Fait

<!-- Pour mémoire ou pour s'auto-féliciter. Les vieux items peuvent être archivés
     en bas du fichier ou supprimés. -->

- Bulk-select + bulk-delete on the Transactions list (row checkboxes, indeterminate header checkbox, action bar + confirm dialog, backend `POST /api/transactions/delete-bulk` with the transfer-leg unlink guard). `Transactions/*`, `transactions.ts`.
- Available vs blocked money on locked accounts (PEA / dépôt à terme). Accounts and transactions carry a `lock_years` column; the Dashboard hero switches to "Disponible" with a "+ X€ bloqués" tag when a lock is unmatured, and each account card shows the split. Migration 0011. `backend/src/db/migrations/0011_lock_years.sql`, `accounts.ts`, `reports.ts`, `Dashboard.tsx`, `Accounts/AccountForm.tsx`.
- Dashboard balance-chart account selector persisted to localStorage — the last account you were watching stays selected across reloads. `Dashboard.tsx`, `lib/persisted-state.ts`.
- Colored kind badges for categories (expense / income / neutral, light tones) + retired the `transfer` kind (internal transfers are already tracked via `transfer_group_id`). Migration 0010 coerces old rows. `lib/categories.ts`, `Rules/CategoryRow.tsx`, `Categories.tsx`, `backend/src/db/migrations/0010_...sql`.
- Drag-to-reorder on the Accounts page (replaces the ↑/↓ arrow buttons; @dnd-kit, keyboard + touch accessible). `Accounts/AccountCard.tsx`, `Accounts/index.tsx`.
- Sidebar user-profile block pinned to the bottom of the left panel on desktop. `Layout.tsx`.
- Fix: balance checkpoints mispositioned on the Dashboard chart (was interpolating by whole-range time fraction instead of bucket index — could drift by several months when buckets are spaced irregularly). `BalanceChart.tsx`.
- Fix: "Devise" (EUR) label rendering below the previous field instead of aligned, in the account edit form (wrapper used `flex flex-col` with no grid). `AccountForm.tsx`.
- Points de contrôle par compte affichés sur le graphique Dashboard (drift vs. cumul calculé, tolérance 1 centime).
- CI GitHub Actions + rapport de couverture Codecov (backend vitest, service Postgres 16, badges dans le README).
- Frontend test harness (Vitest + Testing Library + jsdom) + first refactor+test iteration on Accounts.tsx (split into 6 focused files + 6 characterization + ~20 unit tests). See `STATUS.md` for the interleave progress table.

---

### Notes / réflexions plus longues

<!-- Réflexions multi-lignes qui ne tiennent pas en une puce. Utiliser des sous-titres
     `###` ou `####` si une note grossit, et la promouvoir éventuellement en plan
     dans `docs/superpowers/specs/` si elle devient une vraie fonctionnalité. -->
