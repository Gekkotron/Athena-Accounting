# Merge two accounts — design

**Date**: 2026-07-15
**Status**: spec — pending implementation plan
**Scope**: backend endpoint + minimal Accounts-page UI

## Motivation

Users who accidentally create a duplicate account (typo, wrong currency guessed then corrected by re-creating, etc.) currently have no clean recovery path: `DELETE /api/accounts/:id` fails with `ON DELETE RESTRICT` if any transaction exists. Renaming the duplicate isn't the same operation — it leaves the transaction history split across two rows in `accounts`. This spec adds a single-shot merge that consolidates a source account into a target and removes the source, preserving all downstream data.

## Non-goals

- **Undo the merge.** One-shot destructive. Feature #1 (undo) doesn't extend here.
- **Cross-currency merge with FX conversion.** Rejected 400 up-front.
- **Merging N accounts at once.** Two-at-a-time; chain manually if truly needed.
- **Merge preview.** We describe the effects in the confirmation copy; no separate simulation endpoint.
- **Dedicated audit-log table.** The response payload lists every count; that's the audit for a single-user homelab app.
- **Schema migrations.** Everything runs on existing tables.

## Constraints

- Fastify + Drizzle + `pg` stack; auth via `requireAuth` `preHandler`.
- Public-safe logging: no PII (no account names, no transaction descriptions) in any log line — only `{sourceId, targetId, uid, counts}`.
- LAN-only single-user; no concurrent-write protection needed beyond ordinary row locks.

## Architecture

**Backend** — one new route appended to `backend/src/http/routes/accounts.ts`:

```
POST /api/accounts/:sourceId/merge
body: { targetId: number }
```

The entire merge runs inside a single `db.transaction()`.

**Frontend** — one new component `frontend/src/pages/Accounts/MergeModal.tsx` and a small extension to `AccountCard.tsx` (a "•••" menu with a single "Fusionner avec…" item). One new API function `mergeAccount(sourceId, targetId)` in the accounts fetcher module.

## Request / response

Request body:

```json
{ "targetId": 42 }
```

Response 200:

```json
{
  "ok": true,
  "merged": {
    "transactionsMoved": 47,
    "dedupCollisionsDropped": 2,
    "transferGroupsCollapsed": 1,
    "patternsMoved": 1,
    "checkpointsMoved": 0,
    "budgetsMoved": 0,
    "importsMoved": 3,
    "templatesMoved": 1,
    "draftsMoved": 0,
    "openingBalanceAdded": "500.00"
  }
}
```

## Merge pipeline

Executed inside one DB transaction in this exact order. Rolling back any step rolls back the whole merge.

**Step A — Preserve source's lock intent**

```sql
UPDATE transactions
   SET lock_years = COALESCE(lock_years, <source.lock_years>)
 WHERE account_id = <sourceId>;
```

Account-level `lock_years` acts as a per-row default for transactions where `lock_years IS NULL`. Once we move a transaction to the target, that context is lost. Promoting the source default into the row before the move preserves whatever locks were intended.

**Step B — Drop dedup collisions**

```sql
DELETE FROM transactions
 WHERE account_id = <sourceId>
   AND dedup_key IN (
     SELECT dedup_key FROM transactions WHERE account_id = <targetId>
   )
RETURNING id;
```

Row count → `dedupCollisionsDropped`. If a statement was imported into both accounts by mistake, the target's copy wins.

**Step C — Move remaining transactions**

```sql
UPDATE transactions
   SET account_id = <targetId>
 WHERE account_id = <sourceId>
RETURNING id;
```

Row count → `transactionsMoved`. After this, `transactions.account_id FK ON DELETE RESTRICT` no longer blocks the source's deletion.

**Step D — Collapse self-transfers**

Two statements, in order. The first selects the doomed group ids so we can count them; the second nulls their `transfer_group_id`.

```sql
-- (D1) enumerate groups now entirely on target
SELECT transfer_group_id FROM transactions
 WHERE transfer_group_id IS NOT NULL
 GROUP BY transfer_group_id
HAVING COUNT(*) FILTER (WHERE account_id <> <targetId>) = 0
   AND COUNT(*) > 0;

-- (D2) null them out
UPDATE transactions SET transfer_group_id = NULL
 WHERE transfer_group_id = ANY(<ids from D1>);
```

`transferGroupsCollapsed` = row count of D1 (group count). Transfers whose legs are all on target become ambiguous "self-transfers"; nulling the group id turns them back into ordinary categorized rows.

**Step E — Repoint side tables**

Each has an ON-CONFLICT resolution rule.

| Table | Unique constraint that can collide | Strategy |
|---|---|---|
| `account_filename_patterns` | none binding to `account_id` alone | Straight `UPDATE … SET account_id = target WHERE account_id = source`. |
| `balance_checkpoints` | `(account_id, checkpoint_date)` | Delete source rows whose `checkpoint_date` already exists on target; then UPDATE the rest. |
| `category_budgets` | account-scoped uniq on `(user_id, category_id, period, account_id)` | Delete source rows that would collide on `(user_id, category_id, period, target)`; then UPDATE the rest. |
| `file_imports` | none on `account_id` alone | Straight UPDATE. |
| `pdf_templates` | account-scoped uniqueness (`user_id, fingerprint`) — collides when source and target learned the same layout | Delete source's colliding rows; UPDATE the rest. |
| `pdf_import_drafts` | none | Straight UPDATE (sweeper purges expired within 24h regardless). |

Each moved-row count populates the corresponding `*Moved` field in the response.

**Step F — Bump target's opening balance**

```sql
UPDATE accounts
   SET opening_balance = opening_balance + <source.opening_balance>
 WHERE id = <targetId>;
```

`openingBalanceAdded` returned as `source.opening_balance` verbatim (14.2 decimal string).

**Step G — Delete the source**

```sql
DELETE FROM accounts WHERE id = <sourceId>;
```

The remaining tables with CASCADE onto `accounts.id` (any I overlooked) act as a safety net — they should already have been emptied by Step E.

## Validation

Applied at the top of the handler, before the transaction opens:

- `sourceId` from the URL param, `targetId` from the body — both zod-parsed as `int > 0`.
- `sourceId !== targetId` → 400 `{error: 'source and target must differ'}`.
- `SELECT source, target FROM accounts WHERE id IN (…) AND user_id = uid` — must return exactly 2 rows.
  - Missing source → 404 `{error: 'source not found'}`.
  - Missing target → 404 `{error: 'target not found'}`.
- `source.currency === target.currency` → 400 `{error: 'currency mismatch', sourceCurrency, targetCurrency}` otherwise.

Any 500 from an unexpected pg FK violation post-cleanup logs `err.code` + `err.detail` and returns `{error: 'internal error'}`. Not expected to fire; it's a safety net for future schema additions.

## Frontend

**`AccountCard.tsx`**: add a "•••" icon-button to the existing top-right cluster (next to the drag handle and "modifier" button). It opens a small menu (native `<details>` or a click-outside-closes popover — pick whichever matches the closest existing pattern in the pages/Accounts folder) with a single item `Fusionner avec…`. Menu button uses `aria-haspopup="menu"` + `aria-expanded`.

**`MergeModal.tsx`** (new): receives `source: Account` and `accounts: Account[]` from the parent. Renders:

1. Heading: `Fusionner {source.name} dans un autre compte`.
2. `<select>` populated with every other account of the same currency (filtered client-side; the backend enforces the same rule).
3. Once a target is picked, a preview block listing what will happen:
   - Toutes les transactions du source seront déplacées vers **{target.name}**.
   - Le solde d'ouverture ({formatAmount(source.openingBalance)}) sera ajouté à celui de **{target.name}**.
   - Les patterns, points de contrôle, budgets et historique d'imports rattachés au source seront repointés (les doublons éventuels seront écartés en gardant ceux du target).
   - Les transferts entre les deux comptes seront cassés (redeviennent des transactions ordinaires).
   - **{source.name}** sera supprimé. Cette action est **irréversible**.
4. `Fusionner` button (danger styling), disabled until a target is picked.
5. On click → `POST /api/accounts/{source.id}/merge` with `{targetId}`. On 200: close modal, refresh accounts list, show a toast summarizing the counts (`X transactions déplacées, Y doublons ignorés, solde d'ouverture augmenté de Z`). On error: display the error inline, keep modal open.

**`frontend/src/api/accounts.ts`** (or the equivalent existing module): add

```ts
export interface MergeResult {
  transactionsMoved: number;
  dedupCollisionsDropped: number;
  transferGroupsCollapsed: number;
  patternsMoved: number;
  checkpointsMoved: number;
  budgetsMoved: number;
  importsMoved: number;
  templatesMoved: number;
  draftsMoved: number;
  openingBalanceAdded: string;
}

export async function mergeAccount(
  sourceId: number, targetId: number,
): Promise<MergeResult>
```

Returns the parsed `merged` payload.

## Testing

**Backend — `backend/tests/accounts-merge.test.ts`**, gated on `RUN_DB_TESTS=1`, using `buildApp()` from `tests/helpers/build-app.ts`. Each case builds its own user + accounts so it survives concurrent test-file races (`tests/mcp/store.test.ts` wipes users in its `beforeAll`).

Cases:

1. `POST /api/accounts/999999/merge` → 404 (unknown source).
2. Valid source, garbage target → 404 (unknown target).
3. `sourceId === targetId` → 400.
4. Cross-user attempt (create user A, log in as user B, try to merge A's account) → 404 (non-enumeration: returns "not found" not "forbidden", matches project convention).
5. Currency mismatch (EUR → USD) → 400 with `error: 'currency mismatch'`.
6. Happy path: source has 3 transactions + opening 100, target has 2 + opening 50. After merge: target has 5 transactions, target.opening_balance = 150, `GET /api/accounts/source` → 404, response counts match.
7. Dedup collision: insert same `dedup_key` on both accounts. After merge: source's row was deleted, target's kept, `dedupCollisionsDropped: 1`.
8. Lock-year preservation: source has `lock_years = 5`, its transactions have `lock_years IS NULL`. After merge, those rows have `lock_years = 5`.
9. Transfer collapse: create a transfer group with one leg on source and one on target. After merge, both legs have `transfer_group_id IS NULL`.
10. Repoint side tables: create a filename pattern + a balance checkpoint + a file_import on source. After merge, all three point to target's id.
11. Transactionality: force a failure mid-merge (mock or contrived collision that isn't handled). Assert source still exists, target unchanged, no partial state (spot-check a couple of tables).

**Frontend — `frontend/src/pages/Accounts/__tests__/MergeModal.test.tsx`**:

1. Passed three accounts (EUR, EUR, USD), source EUR → dropdown shows only the other EUR.
2. `Fusionner` disabled until a target is picked.
3. `mergeAccount` mock resolves with counts → modal closes, `onDone` called with counts.
4. `mergeAccount` mock rejects with `Error('currency mismatch')` → modal stays open, error visible inline.

Not tested (upstream trust / non-deterministic):
- Postgres CASCADE behavior.
- Exact SQL statement text (behavior-only assertions).
- Focus-trap keyboard behavior (delegated to whatever library the existing modals use).

## Rollout

Single PR (or single push on `main` per project convention):
- 1 new backend route.
- 1 new backend test file.
- 1 new frontend component + card menu extension + api fetcher.
- 1 new frontend test file.
- No migration, no dependency change, no README change.

Nothing to feature-flag; the merge is invoked only by explicit user action.

## Open questions (deferred to implementation plan)

- Exact idiomatic pattern the project uses for `<details>`-menus vs popovers in AccountCard — the plan should walk the existing pages/Accounts components to match rather than invent.
- The response's `patternsMoved`/`checkpointsMoved`/etc. counters vs a single opaque "sideTablesMoved" — clarify during plan-writing whether the frontend actually uses the detailed counters or a summary is enough. If summary, simplify the payload.
