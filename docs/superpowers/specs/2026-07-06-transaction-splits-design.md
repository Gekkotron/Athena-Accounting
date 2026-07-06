# Transaction splits — design

_Draft: 2026-07-06_

## Goal

Let the user split one transaction across multiple categories (e.g. a
100 € Amazon invoice ventilated as 60 € Livres + 30 € Électro + 10 €
Divers), with a database-side guarantee that the pieces always sum
back to the parent amount to the cent.

Non-goals for v1:

- **Rule-driven auto-splits.** A rule that says "Amazon → 70% Livres,
  30% Neutre" is deferred to a separate spec. The rules engine is
  untouched here.
- **Partial splits with a remainder on the parent's own category.**
  Splits cover 100 % of the parent amount or the transaction is not
  split at all.
- **Inline edit of a single split row.** The API accepts atomic
  full-set replaces only (`PUT /api/transactions/:id/splits`).
- **Compound `POST /api/transactions` that accepts splits inline.**
  The client creates the transaction, then PUTs its splits — two
  round trips.

## Storage

New Postgres table, migration `0014_transaction_splits.sql`:

```sql
CREATE TABLE transaction_splits (
  id             serial PRIMARY KEY,
  transaction_id bigint NOT NULL
                 REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    integer
                 REFERENCES categories(id) ON DELETE SET NULL,
  amount         numeric(14,2) NOT NULL,
  memo           text
);
CREATE INDEX transaction_splits_tx_idx  ON transaction_splits(transaction_id);
CREATE INDEX transaction_splits_cat_idx ON transaction_splits(category_id);
```

Design notes:

- **`ON DELETE CASCADE`** on `transaction_id`: splits die with their
  parent. Consistent with everything else that hangs off a
  transaction row.
- **`ON DELETE SET NULL`** on `category_id`: mirrors
  `transactions.category_id`. A deleted category doesn't wipe the
  split — it becomes an "uncategorized" split, visible in aggregates
  under the same `NULL` bucket the transactions themselves use.
- **No `user_id` column.** Ownership is derived transitively via
  `transaction_id → transactions.user_id`. Every query joins to
  `transactions` anyway, so the redundancy would be pure clutter.
- **Signed amounts** matching parent sign: -60,00 / -30,00 / -10,00
  for a -100,00 Amazon expense. Storing unsigned magnitudes would
  force a sign-flip in every aggregate and re-import path; signed is
  the invariant that costs the least.
- **No `category_source` column.** Splits are always manual — the
  rule engine never produces them (v1 scope).

Drizzle schema entry added to `backend/src/db/schema.ts` in the same
migration commit, following the `balanceCheckpoints` pattern.

### DB-side checksum

Two triggers, both installed by the same migration.

**1. `transaction_splits_checksum`** — deferred trigger on
`transaction_splits`:

```sql
CREATE OR REPLACE FUNCTION transaction_splits_checksum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_id bigint;
  parent_amount numeric(14,2);
  splits_sum numeric(14,2);
BEGIN
  parent_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT amount INTO parent_amount
    FROM transactions WHERE id = parent_id;
  IF parent_amount IS NULL THEN
    RETURN NULL;  -- parent already gone; CASCADE will clean up
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO splits_sum
    FROM transaction_splits WHERE transaction_id = parent_id;
  IF splits_sum <> 0 AND splits_sum <> parent_amount THEN
    RAISE EXCEPTION
      'transaction_splits sum mismatch: parent=% splits=%',
      parent_amount, splits_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transaction_splits_checksum_trg
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_splits_checksum();
```

`DEFERRABLE INITIALLY DEFERRED` lets a client delete-all + re-insert
inside one `BEGIN/COMMIT`; the check fires once at COMMIT with the
final state.

The `splits_sum = 0` branch is what makes DELETE-all valid: after
clearing every split, the sum is 0 and the parent's own `category_id`
becomes authoritative again.

**2. `transactions_amount_lock_when_split`** — non-deferred trigger on
`transactions`:

```sql
CREATE OR REPLACE FUNCTION transactions_amount_lock_when_split()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount <> OLD.amount
     AND EXISTS (SELECT 1 FROM transaction_splits
                  WHERE transaction_id = OLD.id) THEN
    RAISE EXCEPTION
      'cannot change transaction amount while splits exist'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_amount_lock_when_split_trg
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_amount_lock_when_split();
```

Rejects any `UPDATE transactions SET amount = ...` while the row has
splits. Backend catches the `check_violation` and returns 409 with
a French message ("supprimez d'abord la ventilation avant de modifier
le montant").

## Semantics & aggregates

**Interpretation of a row that has splits:**

- `transactions.category_id` and `transactions.category_source` are
  **ignored** in every category aggregate when at least one split
  exists for that row. They are not zeroed on split — they revive
  automatically when all splits are deleted.
- The transaction still appears normally in balance / timeseries /
  account-total aggregates. Only category-scoped queries change.
- A **transfer leg** (`transfer_group_id IS NOT NULL`) cannot be
  split. Enforced in the backend service (400); no DB constraint —
  it's a soft product rule.

**Aggregate rewrite.** Two SQL sites use `SUM(t.amount) GROUP BY
category_id`:

1. `backend/src/http/routes/reports.ts` — `/api/reports/categories`
2. `backend/src/http/routes/tri.ts` — the "Divers" / total-amount
   listing

Both switch to a UNION-based CTE:

```sql
WITH tx_effective AS (
  SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
         t.category_id, t.amount
    FROM transactions t
   WHERE NOT EXISTS (
     SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
   )
  UNION ALL
  SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
         s.category_id, s.amount
    FROM transactions t
    JOIN transaction_splits s ON s.transaction_id = t.id
)
SELECT c.id AS category_id, c.name, ...
     , SUM(e.amount)::text AS total
     , COUNT(*)::int AS transaction_count
  FROM tx_effective e
  LEFT JOIN categories c ON c.id = e.category_id
 WHERE e.user_id = $1
   AND e.transfer_group_id IS NULL
   AND ...
 GROUP BY c.id, c.name, ...
```

`transaction_count` on `/api/reports/categories` counts virtual rows:
a 3-way split contributes 3. Documented in code so a future reader
doesn't try to "fix" it — it is intentional (the UI shows "N lignes
sur cette catégorie", not "N transactions").

**Not-changed queries** (they don't touch category totals):

- `/api/reports/balance` — balance per currency.
- `/api/reports/timeseries` — running per-account balance.
- `accounts.ts` — per-account current balance and available balance.

**List filter fix**: `GET /api/transactions?categoryId=X` currently
matches only `t.category_id = X`. With splits, a Livres-tagged split
of an Amazon transaction would silently disappear from the "Livres"
filter view. Filter becomes:

```sql
WHERE t.category_id = $X
   OR EXISTS (SELECT 1 FROM transaction_splits s
               WHERE s.transaction_id = t.id
                 AND s.category_id = $X)
```

**Sign guard on splits**: each split's amount must be non-zero and
share the parent's sign (parent < 0 → all splits < 0; parent > 0 →
all splits > 0). Zero-amount splits are rejected because they add
noise to the row without carrying information. Enforced in the
backend service (400 on mismatch); not in the DB.

## API

New file `backend/src/http/routes/transactions/splits.ts`, registered
from `routes/transactions/index.ts` next to `registerDuplicateRoutes`.
All routes gated by `preHandler: app.requireAuth`.

### `GET /api/transactions/:id/splits`

- 404 if the transaction doesn't exist or belongs to another user.
- Returns `{ splits: TransactionSplit[] }`. Empty array for a
  non-split transaction (client-shape consistency — no null vs empty
  branching upstream).

### `PUT /api/transactions/:id/splits`

Body (Zod-validated request shape — note `categoryId` is required
non-null on the way in; the stored value can become null later via
`ON DELETE SET NULL`, hence the read-shape divergence):

```ts
{
  splits: Array<{
    categoryId: number;      // required, must belong to same user
    amount: string;          // signed decimal, 2 dp, non-zero
    memo?: string | null;
  }>
}
```

Validation (Zod on the way in, plus DB triggers as belt-and-suspenders):

- `splits.length` in `[2, 20]`. Zero → use DELETE. One → the caller
  should just PATCH the parent's `categoryId`.
- Every `categoryId` resolves to a category owned by the caller
  (400 otherwise).
- `parent.amount != 0` (400 — splitting zero is meaningless).
- `parent.transfer_group_id IS NULL` (400 — transfers can't be
  split).
- Sum-of-amounts (compared as cents to sidestep numeric string
  quirks) equals `parent.amount` (400 otherwise; French message).
- Every split's amount is non-zero and shares the parent's sign
  (400 otherwise).

Semantics: **atomic replace**. Wrapped in one DB transaction — delete
all existing splits, insert the new set. The deferred checksum
trigger fires once at COMMIT. Returns the newly-persisted rows
(with generated `id`s) as `{ splits: TransactionSplit[] }`.

### `DELETE /api/transactions/:id/splits`

Clears every split for the parent. Returns `{ deleted: number }`.
Valid via the deferred trigger (sum becomes 0). The transaction's
own `category_id` becomes authoritative again.

### Existing route touches

- `GET /api/transactions` and `GET /api/transactions/:id` grow a
  `splits: TransactionSplit[]` field on each row (empty when not
  split). Implemented as a single follow-up query
  (`SELECT * FROM transaction_splits WHERE transaction_id = ANY($1)`)
  grouped client-side. Not N+1.
- `GET /api/transactions?categoryId=X` filter extended per the
  aggregates section above.
- `PATCH /api/transactions/:id` in `routes/transactions/index.ts`:
  the existing `try/catch` (which already handles 23505 / 23503)
  grows a branch for SQLSTATE 23514 (`check_violation`) from the
  amount-lock trigger, returning 409 with the French message.

### Error translations

- Trigger `check_violation` on splits → 400
  `{ error: "la somme des ventilations ne correspond pas au montant de la transaction" }`.
- Trigger `check_violation` on parent amount → 409
  `{ error: "supprimez d'abord la ventilation avant de modifier le montant" }`.

## Frontend types

`frontend/src/api/types.ts`:

```ts
export interface TransactionSplit {
  id: number;
  transactionId: number;
  categoryId: number | null;
  amount: string;      // signed, decimal-2
  memo: string | null;
}

export interface Transaction {
  // ...existing fields...
  splits: TransactionSplit[];  // [] when not split
}
```

## Frontend — TransactionModal split editor

New section in `frontend/src/pages/Transactions/TransactionModal.tsx`,
below the existing "Notes" field, above the lock-years block:

```
─── Ventilation par catégorie (optionnel) ─────────────────

  [ 60,00 ]  [ Livres    ▾ ]  [ Kindle          ]  [✕]
  [ 30,00 ]  [ Électro   ▾ ]  [ Casque          ]  [✕]
  [ 10,00 ]  [ Divers    ▾ ]  [                 ]  [✕]

  ┌ Reste à ventiler : 0,00 €                           ┐
  │ Total à répartir : -100,00 €                        │
  │ [+ Ajouter une ligne]                               │
  └─────────────────────────────────────────────────────┘
```

Component state extension:

```ts
type DraftSplit = {
  key: string;                 // React list key, uuid on add
  categoryId: number | '';
  amount: string;              // magnitude, unsigned, user-typed
  memo: string;
};
const [splits, setSplits] = useState<DraftSplit[]>([]);
```

Interaction rules:

- **Empty array = not split.** The section renders a single collapsed
  hint with a `[+ Ventiler cette transaction]` button — no "Reste à
  ventiler" chip yet, since there is nothing to reconcile.
- Clicking `+` seeds **two** rows (a 1-row split is meaningless). The
  second row auto-fills with `parent.amount - firstRow.amount` as the
  user types.
- The "Reste à ventiler" chip is red when non-zero, sage when 0.
  Submit is disabled while red.
- **Sign inheritance**: the user types magnitudes (no minus signs).
  On submit, each amount is re-signed to match the parent's sign.
  Matches the sign-inheritance pattern used elsewhere in the app
  (import forms).
- Removing a row rebalances the delta into the last remaining row so
  the checksum stays green.
- The section is **hidden** with an inline hint when the transaction
  is a transfer leg (`tx.transferGroupId != null`) or when the parent
  amount is 0.

Submit sequencing (create mode):

1. `POST /api/transactions` — same as today.
2. If `splits.length > 0`, chain `PUT /api/transactions/:id/splits`
   in the same `onSuccess`.
3. A PUT failure surfaces on the modal but the transaction is
   persisted — user can retry the ventilation without recreating.

Submit sequencing (edit mode):

1. `PATCH /api/transactions/:id` for changed fields (as today).
2. Then, based on splits:
   - Was empty, now non-empty → `PUT /splits`.
   - Was non-empty, now non-empty → `PUT /splits` (atomic replace).
   - Was non-empty, now empty → `DELETE /splits`.
   - Was empty, still empty → nothing.

## Frontend — TransactionRow expand-on-click

`frontend/src/pages/Transactions/TransactionRow.tsx`:

- When `tx.splits.length > 0`, the category `<select>` cell is
  replaced by a button:

  ```
  [▸ Ventilée (3)]
  ```

- The parent list (`pages/Transactions/index.tsx`) owns a
  `Set<number>` of expanded transaction ids. Clicking the button
  toggles the id in that set.
- Expanded state renders sub-rows below the transaction row, one per
  split:

  ```
    ⤷ Livres     -60,00 €
    ⤷ Électro    -30,00 €
    ⤷ Divers     -10,00 €
  ```

  Memo, when present, is shown in a lighter shade after the category
  name.

- Sub-rows are read-only. To edit, the user opens the transaction
  edit modal (existing pencil icon).

## Backup

`backend/src/http/routes/backup/schema.ts` — bump `VERSION` from `1`
to `2`. Each transaction gains an optional `splits` array:

```ts
splits: z.array(
  z.object({
    category: z.string().nullable(),   // natural key by name
    amount: z.string(),                // signed decimal-2
    memo: z.string().nullable().optional(),
  }),
).optional(),
```

The `BackupBody.version` field becomes `z.union([z.literal(1),
z.literal(2)])`. On v1 backups (pre-splits), no transaction has
splits — treated as empty. On v2, `restore.ts` inserts each parent
transaction and its splits inside the same DB transaction the
importer already uses — the deferred trigger fires once at COMMIT
per file.

## Tests

**Backend** — new `backend/tests/transaction-splits.test.ts`, patterned
after `balance-checkpoints.test.ts`, guarded by `RUN_DB_TESTS`.

1. Unauth GET/PUT/DELETE → 401.
2. PUT with sum ≠ parent amount → 400, no rows written.
3. PUT with sum = parent amount → 201, `GET /:id` returns the
   splits with generated ids.
4. PUT replaces existing splits atomically (old set deleted, new set
   inserted, single COMMIT).
5. PUT with mixed signs on a negative parent → 400.
6. PUT on a transfer leg → 400.
7. PUT referencing a `categoryId` from another user → 400.
8. PUT with 1 or 21 splits → 400 (bounds).
9. PUT on a transaction with `amount = 0` → 400.
10. DELETE clears splits, next `GET /:id/splits` returns `[]`, and
    the parent's own `category_id` is authoritative again.
11. Deleting the parent transaction cascades — splits vanish.
12. Deleting a category that a split references → split's
    `category_id` becomes `NULL`, trigger still passes, aggregates
    still work.
13. `PATCH /api/transactions/:id { amount: ... }` while splits exist
    → 409, parent unchanged, splits unchanged.
14. `GET /api/reports/categories` — parent -100, splits -60/-30/-10 →
    totals per split category, parent's own `category_id` contributes
    nothing.
15. `GET /api/transactions?categoryId=X` — a split-only match is
    included in the result.
16. Backup v2 round-trip — export → wipe → import → same splits.
17. Backup v1 (pre-splits) still imports cleanly.

**Frontend**:

- `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx`
  (new) — opening a non-split tx, clicking "Ventiler", filling three
  lines with a matching sum, submitting → correct PUT payload. Sum
  mismatch disables submit. Removing a row rebalances the last row.
  Transfer leg hides the section.
- `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`
  (extended) — a tx with `splits.length > 0` renders the badge, no
  select. Clicking the badge fires the passed toggle callback.
- `frontend/src/pages/__tests__/Transactions.test.tsx` (extended) —
  filtering by categoryId also surfaces a tx whose splits target that
  category.

## Error handling

- Backend `check_violation` from either trigger → clean 400/409 with
  a French message. No driver-format leakage.
- Frontend split editor: sum-mismatch is caught client-side (submit
  disabled). Server 400 is still handled — displayed at the top of
  the modal in the existing clay-palette banner.
- Frontend PATCH-then-PUT failure in create mode: transaction stays
  persisted, banner explains "ventilation non enregistrée, réessayez".

## Explicit non-goals

- Rule-driven auto-splits (deferred to a separate spec).
- Inline single-split edit (PUT-only, full replace).
- Partial splits with a parent-category remainder.
- Compound `POST /api/transactions` accepting splits inline.
- `?includeSplits=false` toggle on the list endpoint.

## Landing plan

1. **DB layer.** Migration `0014_transaction_splits.sql` (table +
   both triggers), Drizzle schema entry.
2. **Aggregates.** Rewrite `reports.ts` and `tri.ts` to the
   split-aware CTE, with a new backend test asserting split rows
   contribute to their split's category.
3. **Splits routes.** `routes/transactions/splits.ts` +
   registration; `GET /api/transactions` extended to hydrate
   `splits: []`; PATCH parent gains the 409 branch; list-page
   categoryId filter extended.
4. **Backup.** v1 → v2, `restore.ts` splits insert, one round-trip
   test.
5. **Frontend types & modal editor.** `api/types.ts` extended,
   `TransactionModal.tsx` split section, submit sequencing.
6. **Frontend row.** `TransactionRow.tsx` badge + expansion state on
   the parent list.
7. **`TODO.md`** — move the split item to Fait, note the deferred
   rule-driven variant.
