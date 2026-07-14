# Bulk category change for selected transactions

**Date:** 2026-07-14
**Scope:** Add a category selector to the Transactions selection bar so a user can reassign the category of every selected row in one action.

## Problem

The Transactions screen already supports multi-row selection (via checkboxes) and a bulk-delete action. The only way to recategorize is one row at a time via the inline `<select>` in each row — tedious when triaging tens or hundreds of imported transactions that a rule missed.

## Goals

- One-click bulk recategorization of the current selection.
- No new UI paradigm — reuse the existing selection bar and the same native `<select>` styling as the row-level picker.
- Atomic backend write with a single round-trip.
- Skip rows that can't semantically accept a bulk category (transfer legs and split parents) rather than refuse the whole operation.

## Non-goals

- No changes to per-row category editing.
- No changes to the split editor (splits keep their own per-split categories).
- No undo/history. If the user picks wrong, they re-do the bulk change; the previous `categorySource` becomes `'manual'` regardless.
- No client-side filtering of ineligible rows before the request — the server decides what's eligible, so the client stays a thin wrapper.

## User flow

1. User selects rows with the row checkboxes (existing behavior).
2. Selection bar appears with `N sélectionnée(s)  •  Effacer  •  [Catégorie… ▾]  •  Supprimer`.
3. User picks a category from the new dropdown.
4. Mutation fires immediately (no confirm).
5. On success: selection clears; if `skipped > 0`, a dismissable notice reads *"3 lignes ignorées (virements internes ou ventilations)"*.
6. On error: an error notice appears with the server's message; selection stays so the user can retry.

## Backend

**New route** — `POST /api/transactions/categorize-bulk`, added to `backend/src/http/routes/transactions/index.ts` right below the existing `POST /api/transactions/delete-bulk`. Same auth (`userId(req)`), same body-shape discipline, same DB-transaction wrapping.

**Request body** (Zod-validated, added to `schemas.ts`):

```ts
{
  ids: number[] // min 1, max 500, positive ints
  categoryId: number | null // positive int or null
}
```

**Response**:

```ts
{ updated: number, skipped: number }
```

**Logic** (single `db.transaction`):

1. Fetch every selected row scoped to `userId`:
   `SELECT t.id, t.transfer_group_id, EXISTS(SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id) AS has_split FROM transactions t WHERE t.user_id = uid AND t.id IN (:ids)`.
   Rows not owned by the user simply aren't returned — they get counted as skipped.
2. Partition into **eligible** (`transferGroupId IS NULL AND NOT has_split`) and **skipped** (everything else, including ids that don't exist / aren't ours).
3. If `eligible.length > 0`: `UPDATE transactions SET category_id = :cat, category_source = 'manual' WHERE user_id = uid AND id IN (:eligibleIds)`. `categorySource='manual'` mirrors the single-PATCH behavior (line 310 of `index.ts`) so the retroactive recategorizer respects it under `preserveManual: true`.
4. Return `{ updated: eligibleIds.length, skipped: ids.length - eligibleIds.length }`.

**Error handling**:

- FK violation on `category_id` (Postgres `23503`) → `400 { error: 'catégorie inconnue' }`, matching the single PATCH's error shape.
- Zod validation failure → `400 { error: 'invalid input', issues: parsed.error.issues }`.

## Frontend

All changes live in `frontend/src/pages/Transactions/index.tsx`. No changes to `TransactionRow.tsx` or `TransactionsTable.tsx`.

**New state:**

- `bulkCategorizeNotice: { skipped: number } | null` — non-blocking notice after a successful apply, shown only if `skipped > 0`.
- `bulkCategorizeError: string | null` — error message from the API.

**New mutation** (alongside the existing `bulkDelete`):

```ts
const bulkCategorize = useMutation({
  mutationFn: (vars: { ids: number[]; categoryId: number | null }) =>
    api<{ updated: number; skipped: number }>('/api/transactions/categorize-bulk', {
      method: 'POST',
      json: vars,
    }),
  onSuccess: ({ skipped }) => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['tri-groups'] });
    setBulkCategorizeNotice(skipped > 0 ? { skipped } : null);
    setBulkCategorizeError(null);
    setSelectedIds(new Set());
  },
  onError: (err: ApiError) => setBulkCategorizeError(err.message),
});
```

Query keys invalidated: `['transactions']`, `['reports']`, `['tri-groups']`. Not `['accounts']` — balances don't move on a category change (unlike delete).

**Selection bar changes** (`Transactions/index.tsx:263-283`):

- Insert a native `<select>` between the "Effacer la sélection" button and the "Supprimer" button.
- Same styling class as the row-level select (`input-sm` or the bar-friendly equivalent).
- Same option list and sort as the row select (`formatCategoryPath`, sorted by parent-name then child-name).
- First option is `"Catégorie…"` (placeholder, value `""`, disabled/unselectable-but-shown so the user knows what the control does).
- Second option: `"— Aucune"` (value `"none"`, maps to `categoryId: null`).
- `disabled={bulkCategorize.isPending}`.
- `onChange`: read value, reset the `<select>` to the placeholder immediately (controlled with a local reset key so re-picking the same category fires again), then call `bulkCategorize.mutate({ ids: Array.from(selectedIds), categoryId: value === 'none' ? null : Number(value) })`.

**New notice bars** — mirror the existing `checkpointError` pattern (`index.tsx:285-297`):

- Info variant (sage, not clay) when `bulkCategorizeNotice != null`:
  `"{skipped} ligne(s) ignorée(s) (virements internes ou ventilations)"` with a "Fermer" button that sets it to `null`.
- Error variant (clay) when `bulkCategorizeError != null`, same shape as `checkpointError`.

**Reset behavior**: the existing `useEffect` at line 65 already clears `selectedIds` on filter/page change — no changes there. `bulkCategorizeNotice` and `bulkCategorizeError` should also clear when filters change (add them to the same effect).

## Data flow

```
User picks category
      │
      ▼
onChange in selection-bar <select>
      │  { ids: Array.from(selectedIds), categoryId }
      ▼
bulkCategorize.mutate
      │
      ▼
POST /api/transactions/categorize-bulk
      │
      ▼
backend: SELECT eligibility, UPDATE eligible, return {updated, skipped}
      │
      ▼
onSuccess: invalidate queries, clear selection,
           set notice if skipped > 0
      │
      ▼
react-query refetch → table re-renders with new categoryId,
notice bar visible if any row was skipped
```

## Edge cases

| Case | Behavior |
| --- | --- |
| All selected rows are transfer legs / splits | `updated: 0, skipped: N`; the notice explains all rows were ignored; selection still clears. |
| Selection contains rows from a different user (impossible via UI, defense in depth) | Backend scopes by `user_id`; foreign ids are counted as skipped. |
| Selected id no longer exists (deleted from another tab) | Counted as skipped. |
| `categoryId` refers to a deleted / foreign category | Postgres FK error → `400 catégorie inconnue`; nothing updated. |
| Rate: 500-row cap | Enforced by Zod (same cap as delete-bulk). |
| User clicks the placeholder option | It's disabled — no-op. |
| Race: user re-selects the same category | Placeholder-reset trick makes `onChange` fire again; safe (idempotent on server). |
| Same category as the current one | Backend still writes `categorySource='manual'` — that's intentional (user is confirming manual assignment). |

## Testing

**Backend** — new integration tests colocated with existing transaction-route tests:

- Happy path: 3 eligible rows → `{ updated: 3, skipped: 0 }`; DB verifies new `categoryId` + `categorySource='manual'`.
- Mixed selection: 2 eligible + 1 transfer leg + 1 split parent → `{ updated: 2, skipped: 2 }`; transfer leg and split parent verified untouched.
- `categoryId: null` clears the category on eligible rows and still flips `categorySource` to `'manual'`.
- Unknown `categoryId` → `400 { error: 'catégorie inconnue' }`; verify no partial write.
- Cross-user isolation: ids owned by another user counted as skipped, not updated.
- Empty ids → 400 (Zod min 1).
- 501 ids → 400 (Zod max 500).

**Frontend** — new tests in `frontend/src/pages/Transactions/__tests__/`:

- Selection bar renders the category `<select>` when `selectedIds.size > 0`.
- Picking a category fires the mutation with the current `selectedIds` and correct `categoryId`.
- Picking "— Aucune" sends `categoryId: null`.
- After success with `skipped: 0`: selection clears, no notice shown.
- After success with `skipped: 2`: selection clears, notice shows the count.
- After error: error bar shows the message; selection persists.
- Placeholder option is disabled; picking it is a no-op.

## Rollout

Single commit on `main` (per project convention). No feature flag — the feature is additive and has no data-migration surface.
