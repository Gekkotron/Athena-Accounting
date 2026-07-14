# Categories drag-and-drop nesting — design

**Status:** proposed
**Date:** 2026-07-14
**Scope:** `frontend/src/pages/Rules/Categories.tsx` (+ tests). No backend changes.

## Problem

The Categories screen creates and edits categories in a flat table. To nest one
category under another today, the user has to pick the parent from a **"Parent
(optionnel)"** `<select>` in the top create form. This is:

- Not discoverable — the field is one of many in a wide horizontal form.
- Not fluid — once a category exists, changing its parent means opening a
  second `<select>` in the row's hidden-on-mobile "Parent" column.
- Redundant with the visual hierarchy the table already shows.

The user wants direct manipulation: **drag a category onto another to make it
a sub-category**, and drag back out to promote it back to a root. The
hierarchy is shown right in the table with a small vertical gap between
groups.

## Non-goals

- Sub-sub-categories (3+ levels) — the 2-level cap is unchanged and
  enforced by the backend.
- Reordering siblings via drag — categories have no `position` column;
  the API doesn't accept an order patch.
- Multi-select drag.
- i18n groundwork (deferred to the separate public-launch translation project).
- Redesigning the row-level kind-cascade confirm — that stays as-is unless a
  future task revisits it.

## Constraints already in place

The relevant invariants are enforced **server-side** by
`backend/src/http/routes/categories.ts` on `PUT /api/categories/:id`:

- **Self-parent** → 400 `cannot self-parent` (line 104-106).
- **Nesting a row that has children** → 400 `cannot nest a category that has
  children` (line 108-117).
- **Parent must be a root** → 400 `only 2 levels supported` (line 123-125).
- **Kind coercion on nest** → child's kind is silently overwritten to
  `parent.kind` (line 126). No confirmation needed client-side.
- **Kind cascade to children when a root's kind changes** — transactional
  (line 149-159), same as today.

Because the backend already coerces `kind` on nest, the frontend does not
need a confirm dialog for kind mismatches.

## Approach

Keep the existing 7-column `<table>` in `Categories.tsx`. Add:

1. A **leading drag-handle column** (`⋮⋮` glyph, `text-ink-500`,
   `cursor-grab`).
2. `@dnd-kit/core` `DndContext` wrapping the tbody, `PointerSensor` with
   `activationConstraint: { distance: 4 }` (same shape as
   `frontend/src/pages/Accounts/index.tsx:78-80`), plus `KeyboardSensor`
   for a11y.
3. `useDraggable` on each row (via the handle), `useDroppable` on every root
   row and on a **top-of-table "promote to root" band** that fades in only
   while a drag is active.
4. A spacer `<tr aria-hidden><td colSpan={N} className="h-3"/></tr>` between
   root groups for the "little space below" ask.

Remove:

- The **Parent (optionnel)** `<select>` in the create form (`Categories.tsx:
  128-143`).
- The **Parent** column header (`184`) and per-row cell (`361-382`).
- `parentIdInCreate` state, `setParentIdInCreate`, `parentInCreate`,
  `effectiveCreateKind` derivation. Type is unconditional in the create form.
- `parentOptions`, `parentDisabled` locals in `CategoryTableRow`.

## Rejected alternative

**Replace the table with a nested list of cards.** Cleaner grouping without
a spacer-row trick, but loses column alignment for kind/color/interne/total,
diverges from the sibling `Rules` pages that all use tables, and forces a
redesign of every inline edit. Bigger blast radius for the same core win.

## Interaction model

### Drag start

- Trigger: mouse-down on the `⋮⋮` handle, 4px activation distance.
- Handle is **disabled** (grey, `cursor-not-allowed`) when the row is a root
  that has ≥ 1 child. Tooltip:
  *"Cette catégorie a des sous-catégories — elle ne peut pas être
  imbriquée."*
- Body cursor becomes `grabbing`. A dnd-kit `DragOverlay` renders a
  simplified ghost (name + kind badge only).

### Drop zones and outcomes

| Drop target | Dragged item | Result |
|---|---|---|
| Root row | Root without children | Nest as child; backend coerces kind |
| Root row | Child | Re-parent to the new root |
| Top "promote to root" band | Child | `parentId = null` |
| Own current parent | Child dragged back to its parent | No-op |
| Self | Any | No-op (client-guarded) |
| Descendant of dragged row | Any | No-op (client-guarded; also 400 server-side) |

Valid drop targets get `ring-2 ring-sage-300/60` on hover. The top band is
labelled *"Déposez ici pour promouvoir en racine"* and is invisible when no
drag is active.

### Drag end

- Fire `updateCategory.mutate({ id, patch: { parentId: newParent } })`
  where `newParent` is `null` (promote) or the target root id (nest / re-parent).
- Optimistic cache update inside `onMutate`: patch the `['categories']` query
  data so the row re-parents instantly (mirror
  `Accounts/index.tsx:55-76`).
- On error, roll back the cache and surface `err.message` in the same red
  inline `text-clay-300` style already used by `create.onError`.

### Kind on nest

No client dialog. Backend sets `payload.kind = parent.kind`. React Query
invalidates on success; the row re-renders with the new kind. If the user
wants to undo, they drag back out.

## Edge cases (client-side guards)

- `dragged.id === target.id` → no-op.
- `dragged.parentId === target.id` → no-op (already nested there).
- `target.parentId === dragged.id` → no-op (would form a cycle).
- Root-with-children dragged → cannot start; handle disabled.
- Root dragged onto the promote-to-root band → no-op.
- Failed mutation → rollback + inline error; drop targets remain interactive.

Concurrent drags don't need special handling: react-query `onMutate` reads
whatever the cache holds when it runs, so back-to-back patches compose the
same way the `Accounts` reorder pattern already does.

## Accessibility

- Drag handle is a `<button type="button">` with
  `aria-label="Déplacer la catégorie « <name> »"`.
- `KeyboardSensor` + `sortableKeyboardCoordinates` gives space/enter to
  start, arrow keys to move focus among drop targets, space/enter to drop,
  escape to cancel.
- Promote-to-root band gets `role="region"
  aria-label="Déposez ici pour promouvoir en racine"` only while active.
- Table markup and all existing per-cell controls stay unchanged; screen
  readers keep the full grid.

## Files touched

- `frontend/src/pages/Rules/Categories.tsx` — main change.
- `frontend/src/pages/Rules/__tests__/Categories.test.tsx` — test updates
  (see below).
- Possibly a small extract: `frontend/src/pages/Rules/CategoryDragHandle.tsx`
  if the button + tooltip logic becomes too heavy inline; not mandatory.

No new dependencies. `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
are already installed.

## Tests

Extend `frontend/src/pages/Rules/__tests__/Categories.test.tsx`:

1. Renders the drag handle on every row; disabled on a root-with-children
   with the correct French tooltip; enabled on a childless root and on any
   child.
2. Drag a childless root onto another root → mutation fired with
   `{ parentId: <targetId> }`.
3. Drag a child onto the top promote-to-root band → mutation fired with
   `{ parentId: null }`.
4. Drag onto self → no mutation.
5. Drag a child onto its own parent → no mutation.
6. Failed mutation (mock a 400) → optimistic cache write rolled back,
   inline error visible.
7. Top promote-to-root band is not in the DOM when no drag is active;
   is rendered while a drag is in progress.

Existing "delete cascades sub-catégories" and "renames on blur" tests stay.
The "create with Parent select" test disappears with the field.

Reuse the dnd-kit test pattern already established in
`frontend/src/pages/Accounts/__tests__/AccountCard.test.tsx` — wrap the
component in `<DndContext>` for hook context; simulate drag by either
`@testing-library/user-event` pointer sequences or by invoking `DndContext`'s
`onDragEnd` with a synthesized event (whichever Accounts uses; keep the same
approach for consistency).

## Deletions summary (line refs, `Categories.tsx`)

| Removed | Line(s) |
|---|---|
| `parentIdInCreate` state | 24 |
| Parent `<select>` in create form | 128-143 |
| `parentInCreate`, `effectiveCreateKind` | 98-99 |
| `parentId` in `create.mutate` payload | 75 (becomes `parentId: null`) |
| Parent `<th>` | 184 |
| Parent `<td>` with the select | 361-382 |
| `parentOptions` + `parentDisabled` locals | 281-290 |
| Reset `setParentIdInCreate(null)` on success | 38 |

## Open items after implementation

None — this design closes the immediate UX gap. A separate follow-up could
replace the row-level kind-cascade `window.confirm` with the project's
`ConfirmDialog` for consistency, but that's out of scope here.
