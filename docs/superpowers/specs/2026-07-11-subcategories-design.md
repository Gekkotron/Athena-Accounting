# Sub-categories — 2-level category hierarchy

**Date:** 2026-07-11
**Status:** Approved (design)
**Type:** Classification / data model + downstream propagation

## Summary

Let users nest categories one level deep (e.g. `Courses › Alimentation`,
`Courses › Ménage`). The `categories.parent_id` column already exists and is
already respected by the Sankey rollup and by the backup export/restore
round-trip; the missing pieces are the Categories UI, the backend guarantees
around the invariants, and the "Parent › Leaf" display in every downstream
consumer (Transactions, Rules, Budgets, Tri, Doublons, Insights). Depth is
capped at two levels — no grandchildren.

## Goals

- Ship a coherent 2-level hierarchy across the whole classification stack.
- Preserve existing single-level behavior for users who never create a child
  category (zero regressions on flat setups).
- Keep the invariants (kind inheritance, depth cap, uniqueness) enforced at
  the API layer so backup restore and any future non-UI writer stay honest.

## Non-goals (v1)

- Deeper hierarchies (3+ levels).
- Drag-to-nest in the Categories page; "move N categories under parent" bulk
  action; tree picker in Rules/Transactions modals. These are polish for a
  later iteration.
- Rolling up leaves in the Category donut / Category breakdown views — they
  stay flat to preserve the child detail the user just took the trouble to
  create.
- Splitting a rule so that matching a parent expands to its children — a rule
  targets exactly one category (parent OR leaf) chosen by the user.

## Decisions (from brainstorming)

- **Assignment level:** any category (parent OR leaf) can receive
  transactions and rules. Promoting a category to parent by adding children
  under it must not force a migration of already-assigned rows.
- **UI shape:** grouped rows on the Categories page — a parent row is
  followed by its indented children. Parents without children are visually
  identical to today.
- **Budgets:** any-level. Setting a budget on a parent rolls up
  `actual = own + all descendants`. Leaves keep the current single-category
  `SUM`.
- **Row-level display:** show `Parent › Leaf` in Transactions, Tri, Doublons,
  Splits, and every category picker. Leaves without a parent still show
  just their name.
- **Kind inheritance:** child inherits its parent's `kind` and cannot change
  it. Changing a parent's `kind` cascades to all its children in the same
  transaction. Enforced server-side.

## Data model & migration

- Column `categories.parent_id` (`REFERENCES categories(id) ON DELETE SET
  NULL`) already exists — no column change.
- **Uniqueness index switch (migration `0016_subcategories.sql`):** drop
  `categories_user_name_idx` on `(user_id, name)`; create
  `categories_user_parent_name_idx` on `(user_id, COALESCE(parent_id, 0),
  name)`. Two `Restaurant` rows are now legal under two different parents;
  two `Restaurant` rows under the same parent (or two top-level `Restaurant`
  rows) are still forbidden.
- No data backfill required — existing rows all have `parent_id = NULL`, so
  the `COALESCE` bucket for those rows is `0` and the pre-existing
  same-name constraint at top level is preserved.
- No downstream table change. `category_budgets.category_id` stays a plain
  FK; rollup is computed in the report query, not in storage.
- On `parent` delete, existing `ON DELETE SET NULL` promotes the children to
  top-level. Confirmed as the v1 behavior (no reassignment prompt).

## Backend

### `POST /api/categories`

When `parentId` is present:

- Load the parent row; must belong to the same `userId`. → 400
  `"parent not found"` otherwise.
- Reject if the parent itself has a `parent_id`. → 400
  `"only 2 levels supported"`.
- Coerce `kind` server-side to the parent's `kind` (the UI already disables
  the picker; the coercion protects direct API writers).

### `PUT /api/categories/:id`

- If `parentId` changes (including being set for the first time):
  - Same parent-exists / parent-belongs-to-user / parent-has-no-parent
    checks as `POST`.
  - Reject if the row being updated already has children (would create a
    3-level chain). → 400 `"cannot nest a category that has children"`.
  - Self-parent (`parentId === id`) → 400.
  - Coerce the row's `kind` to the new parent's `kind` in the same
    transaction (symmetric with `POST`). This is what lets `backup/restore`
    two-pass — create with an arbitrary kind, then link parent — succeed
    even when the exported child kind matches the new parent's.
- If `kind` changes on a **parent** (a row with children): cascade the new
  `kind` to all children in the same DB transaction. Children stay coherent
  by construction.
- If a request touches `kind` on a **child row** (a row with `parent_id
  IS NOT NULL`) *without* also changing `parentId`, and the new `kind`
  differs from the current parent's `kind`: reject → 400
  `"child kind is inherited from parent"`. (Bare kind edits on a child are
  only allowed when they're a no-op or would match the parent — the picker
  is disabled in the UI, so this is a direct-API guard.)

### `DELETE /api/categories/:id`

No change. `ON DELETE SET NULL` promotes children to top-level.

### `GET /api/categories`

No shape change. `parent_id` is already returned. Order remains
`(kind, name)`.

### `/api/reports/budget`

Extend the aggregation query so a parent's `actual` becomes the sum of the
transactions on the parent **and** all its descendants. Implementation
sketch: pre-compute `descendants_of(category_id)` via a small
`categories_with_descendants` CTE (2 levels, so a single self-join is
enough), then `WHERE t.category_id = ANY(descendants_of(row.category_id))`.
Leaves stay on the current single-category `SUM`.

### Backup import (`backup/restore.ts`)

Already links parents in a second pass. No change beyond re-using the new
validators. Existing round-trip test keeps covering export → restore.

## Frontend

### Categories page (`frontend/src/pages/Rules/Categories.tsx`)

Same top-level shape (form + table). Table now groups.

- **Row model:** build `roots: Category[]` (`parentId == null`, sorted by
  `(kind, name)`) and `childrenByParent: Map<number, Category[]>` (children
  sorted by `name`). Render each root, then its children indented right
  after — no separate section headers.
- **Parent selector column:** inline `<select>` on every row.
  - On a root row: options are `—` (top-level) + every *other* root without
    children.
  - On a child row: options are `—` (promote to top-level) + every root
    without a parent.
  - On a root that already has children: the parent select is disabled and
    shows a tooltip explaining the depth cap.
- **Kind on children:** picker disabled with tooltip `« hérité de {parent} »`.
- **Kind on parents:** changing it shows a small warning
  (`« s'applique aussi aux N sous-catégories »`) before the mutation fires.
- **Parent-row total:** displays `own + rolled-up children` as a single
  amount so the grouped block still adds up at a glance.
- **Create form:** adds a `Parent (optionnel)` select. Selecting a parent
  visually locks the Kind picker to the parent's kind (echo of the server
  rule; server coerces regardless).
- **Delete confirm dialog:** if the target row has children, append the line
  `« Ses N sous-catégories deviendront des catégories racine. »` so the
  effect of the cascade is clear.
- `CategoryBreakdown` (top of the page) unchanged — it consumes
  `/api/reports/categories` and rollup is a report-layer concern.

### Shared helper

`frontend/src/lib/categories.ts` gains:

```ts
export function formatCategoryPath(
  cat: Category,
  byId: Map<number, Category>,
): string {
  if (cat.parentId == null) return cat.name;
  const parent = byId.get(cat.parentId);
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}
```

The `›` glyph (U+203A) matches the option previews approved during
brainstorming.

### Downstream consumers

- **Category pickers** (Rules, `TransactionModal`, `SplitEditor`, Tri,
  Doublons): options render `formatCategoryPath`. Value stays `cat.id`.
  Sort dropdown entries by `(parentPath, name)` so children appear right
  under their parent.
- **Transactions list** (`Transactions/TransactionRow.tsx`): the category
  cell renders `formatCategoryPath`.
- **Splits editor / modal:** same helper.
- **Tri:** target-category chip and picker use the helper.
- **Doublons:** row summary uses the helper.
- **Rules:** the "then category" chip and picker use the helper. Rule
  matching is a plain `category_id` set; parents don't cascade to children
  (users pick the leaf they mean).
- **Budgets page** (`Budgets.tsx`): grouped rendering mirrors the Categories
  page — parent row shows `actual / limit (rolled up)`, child rows show the
  leaf's own `actual` and (if set) leaf limit. Uses the new
  `/api/reports/budget` rollup.
- **Sankey** (`Dashboard/sankey.ts`): no code change — `rootOf()` already
  walks the `parentId` chain. Existing tests keep it honest.
- **Insights** (`Dashboard/insights.ts`): the "top category movers" section
  aggregates report rows at the root via the same `rootOf` logic *before*
  ranking, so `Courses` outranks its individual children in the narrative.
- **CategoryDonut / CategoryBreakdown:** keep flat (per non-goals).

## Testing

Follow the existing gates (DB-gated backend suites, vitest + Testing Library
frontend).

### Backend

- `categories.test.ts` — new cases:
  - `POST` parent-not-found → 400
  - `POST` parent-with-parent → 400 `"only 2 levels supported"`
  - `POST` child kind coerced to parent's kind (assert stored row)
  - `PUT` self-parent → 400
  - `PUT` cycle: with B's `parent_id = A`, trying to set A's `parent_id = B`
    → 400 `"cannot nest a category that has children"` (A already has B as
    a child, so nesting A would create a 3-level chain / cycle).
  - `PUT` kind change on parent cascades to children
  - `PUT` bare kind change on child that would deviate → 400
  - `PUT` setting `parentId` on a mismatched-kind row coerces `kind` to the
    parent's (protects backup restore two-pass)
  - `DELETE` parent promotes children to top-level
  - `POST` two `Restaurant` under two different parents → both 201
  - `POST` two `Restaurant` under the *same* parent → second 409
- `reports.test.ts` — budget rollup: parent `actual = own + descendants`;
  leaf unchanged.
- Migration `0016` — up-only test: create children with duplicate names
  under different parents; assert both accepted.

### Frontend

- `Categories.test.tsx` — grouped rendering; parent select disabled for a
  row that has children; kind picker disabled on child; create form locks
  kind when a parent is selected; delete-confirm shows the extra line when
  applicable.
- `lib/categories.test.ts` — `formatCategoryPath` root vs child vs orphan
  (parent missing from the map).
- `Budgets.test.tsx` — parent row shows rolled-up `actual`; child row shows
  its own actual only.
- `Insights.test.ts` — top movers rank at root; leaf change folds into its
  root's delta.
- `Transactions/TransactionRow.test.tsx` — nested category cell renders
  `"Parent › Leaf"`; root category renders plain leaf.

### Manual smoke (before commit)

1. Create `Courses (dépense)` → add `Alimentation` under it → confirm kind
   picker locked to dépense; create `Restaurant` under both `Loisirs` and
   `Voyages` (uniqueness scoped to parent).
2. Assign existing transactions to `Alimentation` → open Sankey; `Courses`
   node aggregates the child.
3. Set a budget on `Courses` → Budgets page shows the rollup; assign a
   leaf-only limit → child row shows it.
4. Delete `Courses` → its children now render as top-level roots.

## Open questions / follow-ups

- Reconsider rolling up the Category donut / breakdown once real users have
  built a hierarchy — currently punted to preserve leaf visibility.
- Bulk "move N categories under parent" action — noted as v2 polish.
- Drag-to-nest on the Categories page — v2 polish.
