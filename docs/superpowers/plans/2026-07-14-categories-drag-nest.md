# Categories Drag-and-Drop Nesting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Parent (optionnel)" dropdown UX on the Categories screen with drag-and-drop nesting: drag a category onto a root to nest it, drop above the first root to promote back, and render children directly beneath their parent with a small gap between groups.

**Architecture:** Frontend-only change in `frontend/src/pages/Rules/Categories.tsx`. Reuses the existing `@dnd-kit/core` + `PointerSensor` + optimistic `onMutate` pattern from `frontend/src/pages/Accounts/index.tsx`. All hierarchy invariants (self-parent, 2-level cap, kind coercion) already enforced by `backend/src/http/routes/categories.ts` on `PUT /api/categories/:id`. Drop-resolution logic is extracted to a pure function `resolveDrop` so it's unit-testable without simulating pointer events in jsdom.

**Tech Stack:** React 18, TypeScript, `@dnd-kit/core`, `@dnd-kit/utilities`, `@tanstack/react-query`, Vitest + `@testing-library/react`.

## Global Constraints

- **Attribution:** All commits use `Gekkotron` identity (`git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com …`). Never write the user's real name into any file.
- **Public-safe:** No IPs, hostnames, or secrets in commit messages or code. Project is going public.
- **Work on main:** Commit directly to `main`. Do not create a branch. Do not push unless explicitly asked.
- **Copy language:** All user-visible strings are French, matching the existing app.
- **Backend:** No changes. `PUT /api/categories/:id` already enforces every invariant.
- **No new deps:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` are already installed.

---

## File Structure

**Modified:**
- `frontend/src/pages/Rules/Categories.tsx` — remove Parent field + column; add DnD.
- `frontend/src/pages/Rules/__tests__/Categories.test.tsx` — update tests to match new UI.

**Created:**
- `frontend/src/pages/Rules/dragNest.ts` — pure `resolveDrop` function.
- `frontend/src/pages/Rules/__tests__/dragNest.test.ts` — unit tests for `resolveDrop`.

No other files touched.

---

### Task 1: Remove the "Parent (optionnel)" field from the create form

**Files:**
- Modify: `frontend/src/pages/Rules/Categories.tsx`
- Test: `frontend/src/pages/Rules/__tests__/Categories.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: create-form no longer emits `parentId` in the POST body; `useState<number | null>(null)` slot for `parentIdInCreate` is gone; `effectiveCreateKind` derivation is gone.

- [ ] **Step 1: Update the test suite — replace the "locks kind" test with a "no Parent field" test**

Open `frontend/src/pages/Rules/__tests__/Categories.test.tsx`. **Delete** the existing test at lines 204-217 (the block starting with `it('locks kind in the create form when a parent is selected', ...`). Replace it with:

```tsx
  it('does not render a Parent field in the create form', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    expect(
      screen.queryByRole('combobox', { name: /parent \(optionnel\)/i }),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify the new test fails**

Run: `cd frontend && npm test -- Categories.test.tsx --run`
Expected: `does not render a Parent field in the create form` FAILS (the field is still there). All other tests pass.

- [ ] **Step 3: Remove the create-form Parent state and select**

In `frontend/src/pages/Rules/Categories.tsx`:

Delete line 24:
```tsx
  const [parentIdInCreate, setParentIdInCreate] = useState<number | null>(null);
```

In the `create.onSuccess` handler (around line 34-39), delete the `setParentIdInCreate(null)` line so it reads:
```tsx
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName('');
      setColor('');
    },
```

In `submit` (line 68-77), remove the `parentId` field from the mutate payload:
```tsx
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      name: name.trim(),
      kind,
      color: color || null,
      parentId: null,
    });
  };
```

Delete lines 98-99 (the `parentInCreate` / `effectiveCreateKind` derivation):
```tsx
  const parentInCreate = parentIdInCreate != null ? byId.get(parentIdInCreate) : null;
  const effectiveCreateKind = parentInCreate ? parentInCreate.kind : kind;
```

Delete the entire Parent `<select>` block in the create form (lines 128-143):
```tsx
        <div className="w-full sm:w-56">
          <label className="label mb-1.5 block" htmlFor="cat-create-parent">
            Parent (optionnel)
          </label>
          <select
            id="cat-create-parent"
            className="input"
            value={parentIdInCreate ?? ''}
            onChange={(e) => setParentIdInCreate(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
```

In the Type `<select>` block (lines 144-162), remove the inheritance-related props so it reads:
```tsx
        <div className="w-full sm:w-40">
          <label className="label mb-1.5 block" htmlFor="cat-create-kind">Type</label>
          <select
            id="cat-create-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
          >
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- Categories.test.tsx --run`
Expected: all tests pass, including `does not render a Parent field in the create form`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unused-import warnings from `byId`; if TS complains that `byId` is unused, remove its `useMemo` too — but the row-level code still uses it, so it should stay).

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add frontend/src/pages/Rules/Categories.tsx frontend/src/pages/Rules/__tests__/Categories.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
refactor(categories): drop Parent field from create form

Nesting will be done via drag-and-drop instead. Type select is now
unconditional (no more inheritance branching in the create form).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Remove the "Parent" column from the table

**Files:**
- Modify: `frontend/src/pages/Rules/Categories.tsx`
- Test: `frontend/src/pages/Rules/__tests__/Categories.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: table has 6 data columns instead of 7 (Name, Type, Interne, Couleur, Total, delete). `CategoryTableRow` no longer accepts `parent`, `roots`, or `childrenByParent` props for the purpose of a parent select (they may still be needed elsewhere — read the code carefully; they are used only for `parentOptions` which is being removed).

- [ ] **Step 1: Update the test suite — replace the "disables the parent selector" test**

Open `frontend/src/pages/Rules/__tests__/Categories.test.tsx`. **Delete** the existing test at lines 195-202 (`it('disables the parent selector on a category that already has children', ...)`). It will be superseded by the "drag handle disabled" test in Task 3; for now we simply verify the Parent column is gone:

```tsx
  it('does not render a Parent column in the table header', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    // The "Parent" <th> was the only cell with the exact text "Parent"; other
    // occurrences ("Parent (optionnel)") were in the create form label, which
    // Task 1 deleted.
    expect(screen.queryByRole('columnheader', { name: /^parent$/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify the new test fails**

Run: `cd frontend && npm test -- Categories.test.tsx --run`
Expected: `does not render a Parent column in the table header` FAILS (the column is still there).

- [ ] **Step 3: Remove the Parent column**

In `frontend/src/pages/Rules/Categories.tsx`:

Delete the Parent `<th>` (line 184):
```tsx
                <th className="px-4 py-3 label font-normal hidden lg:table-cell">Parent</th>
```

Delete the entire Parent `<td>` block inside `CategoryTableRow` (lines 361-382, the block starting with `<td className="px-4 py-2.5 hidden lg:table-cell">` and containing the parent `<select>`).

Delete `parentOptions` and `parentDisabled` locals inside `CategoryTableRow` (lines 281-290):
```tsx
  const parentOptions = roots.filter(
    (r) => r.id !== c.id && (childrenByParent.get(r.id)?.length ?? 0) === 0,
  );
  // Ensure the current parent is always visible in the dropdown (it might have gained other children since).
  if (parent && !parentOptions.some((r) => r.id === parent.id)) {
    parentOptions.push(parent);
  }

  const kindDisabled = depth === 1;
  const parentDisabled = depth === 0 && hasChildren;
```

Keep `kindDisabled = depth === 1;` — it's still used by the Type select.

Now review `CategoryTableRow`'s prop list (lines 268-278). The props `parent`, `roots`, and `childrenByParent` were used by:
- `parentOptions` derivation (now deleted)
- The Parent `<td>` (now deleted)
- The `title` on the kind select uses `parent.name` (line 337) — still used
- The `window.confirm` on kind cascade uses `childrenByParent.get(c.id)` (line 342) — still used

So `parent` stays (still referenced by the Type select's `title`) and `childrenByParent` stays (still referenced by the cascade confirm). `roots` is now unused — delete it from the props type and the call site (lines 207, 220).

Updated prop list:
```tsx
function CategoryTableRow(props: {
  c: Category;
  depth: 0 | 1;
  total: number;
  hasChildren: boolean;
  parent: Category | null;
  childrenByParent: Map<number, Category[]>;
  updateCategory: UpdateMutation;
  onDelete: () => void;
}): JSX.Element {
  const { c, depth, total, hasChildren, parent, childrenByParent, updateCategory, onDelete } = props;
```

Remove `roots={roots}` from both call sites (lines 207 and 220).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- Categories.test.tsx --run`
Expected: all tests pass, including `does not render a Parent column in the table header`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds. If TS complains that `roots` is unused in `Categories()`, keep it — it's still used to iterate top-level rows in the tbody at line 197.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add frontend/src/pages/Rules/Categories.tsx frontend/src/pages/Rules/__tests__/Categories.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
refactor(categories): drop Parent column from the table

The parent relationship becomes visible-only via the indented child row.
Reassignment moves to drag-and-drop in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add drag-and-drop nesting

**Files:**
- Create: `frontend/src/pages/Rules/dragNest.ts`
- Create: `frontend/src/pages/Rules/__tests__/dragNest.test.ts`
- Modify: `frontend/src/pages/Rules/Categories.tsx`
- Test: `frontend/src/pages/Rules/__tests__/Categories.test.tsx`

**Interfaces:**
- Consumes: `Category` from `../../api/types`.
- Produces:
  - `resolveDrop(activeId: number, target: DragTarget | null, categories: Category[]): { id: number; parentId: number | null } | null` — pure decision function. Returns `null` for no-op drops.
  - `DragTarget = { kind: 'root'; targetId: number } | { kind: 'promote' }` — union of drop-zone types.
  - `PROMOTE_DROP_ID = 'promote-root'` — string ID used by `useDroppable` for the top band, so the drag-end handler can distinguish it from numeric row IDs.

#### Sub-plan A: Pure drop-resolution function

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/pages/Rules/__tests__/dragNest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveDrop } from '../dragNest';
import type { Category } from '../../../api/types';

const c = (id: number, parentId: number | null = null): Category => ({
  id,
  name: `cat-${id}`,
  kind: 'expense',
  color: null,
  parentId,
  isDefault: false,
  isInternalTransfer: false,
});

describe('resolveDrop', () => {
  it('nests a childless root under another root', () => {
    const cats = [c(1), c(2)];
    expect(resolveDrop(1, { kind: 'root', targetId: 2 }, cats)).toEqual({
      id: 1,
      parentId: 2,
    });
  });

  it('re-parents an existing child onto a different root', () => {
    const cats = [c(1), c(2), c(3, 1)];
    expect(resolveDrop(3, { kind: 'root', targetId: 2 }, cats)).toEqual({
      id: 3,
      parentId: 2,
    });
  });

  it('promotes a child back to root', () => {
    const cats = [c(1), c(2, 1)];
    expect(resolveDrop(2, { kind: 'promote' }, cats)).toEqual({
      id: 2,
      parentId: null,
    });
  });

  it('returns null when a root is dropped on the promote band (already root)', () => {
    const cats = [c(1)];
    expect(resolveDrop(1, { kind: 'promote' }, cats)).toBeNull();
  });

  it('returns null when dropped on self', () => {
    const cats = [c(1)];
    expect(resolveDrop(1, { kind: 'root', targetId: 1 }, cats)).toBeNull();
  });

  it('returns null when dropped on the current parent (no-op)', () => {
    const cats = [c(1), c(2, 1)];
    expect(resolveDrop(2, { kind: 'root', targetId: 1 }, cats)).toBeNull();
  });

  it('returns null when target is not a root (2-level rule)', () => {
    const cats = [c(1), c(2, 1), c(3)];
    // 3 is a root, we drag it onto 2 which is a child — invalid.
    expect(resolveDrop(3, { kind: 'root', targetId: 2 }, cats)).toBeNull();
  });

  it('returns null when the dragged row already has children', () => {
    const cats = [c(1), c(2), c(3, 1)];
    // 1 is a root with child 3; cannot be nested under 2.
    expect(resolveDrop(1, { kind: 'root', targetId: 2 }, cats)).toBeNull();
  });

  it('returns null when target is missing', () => {
    expect(resolveDrop(1, null, [c(1)])).toBeNull();
  });

  it('returns null when active is not in the list', () => {
    expect(resolveDrop(99, { kind: 'root', targetId: 1 }, [c(1)])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- dragNest.test.ts --run`
Expected: FAIL — `Cannot find module '../dragNest'`.

- [ ] **Step 3: Write the module**

Create `frontend/src/pages/Rules/dragNest.ts`:

```ts
import type { Category } from '../../api/types';

export const PROMOTE_DROP_ID = 'promote-root';

export type DragTarget =
  | { kind: 'root'; targetId: number }
  | { kind: 'promote' };

export function resolveDrop(
  activeId: number,
  target: DragTarget | null,
  categories: Category[],
): { id: number; parentId: number | null } | null {
  if (!target) return null;
  const active = categories.find((c) => c.id === activeId);
  if (!active) return null;

  if (target.kind === 'promote') {
    if (active.parentId == null) return null;
    return { id: activeId, parentId: null };
  }

  // target.kind === 'root'
  if (target.targetId === activeId) return null;
  if (active.parentId === target.targetId) return null;

  const targetCat = categories.find((c) => c.id === target.targetId);
  if (!targetCat) return null;
  if (targetCat.parentId != null) return null;

  const hasChildren = categories.some((c) => c.parentId === activeId);
  if (hasChildren) return null;

  return { id: activeId, parentId: target.targetId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- dragNest.test.ts --run`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add frontend/src/pages/Rules/dragNest.ts frontend/src/pages/Rules/__tests__/dragNest.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): pure resolveDrop for drag-nest decisions

Encapsulates every invariant (self, own-parent, cycle, 2-level, target-must-
be-root, dragged-has-no-children) so the DnD wiring in the component can
stay thin. Unit-tested in isolation — no jsdom pointer simulation needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### Sub-plan B: Wire DnD into the Categories page

- [ ] **Step 6: Write the failing component tests**

Open `frontend/src/pages/Rules/__tests__/Categories.test.tsx`. **Add** at the bottom of the `describe('Categories page', ...)` block (before the closing `});`):

```tsx
  it('renders a drag handle button on every row', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    // One handle per row (2 rows in the nested fixture).
    const handles = screen.getAllByRole('button', { name: /déplacer la catégorie/i });
    expect(handles).toHaveLength(2);
  });

  it('disables the drag handle on a root that already has children', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const parentRow = parent.closest('tr')!;
    const handle = within(parentRow).getByRole('button', { name: /déplacer la catégorie/i });
    expect(handle).toBeDisabled();
    expect(handle).toHaveAttribute(
      'title',
      expect.stringContaining('sous-catégories'),
    );
  });

  it('leaves the drag handle enabled on a child row', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const child = await findCategoryNameInput('Alimentation');
    const childRow = child.closest('tr')!;
    const handle = within(childRow).getByRole('button', { name: /déplacer la catégorie/i });
    expect(handle).not.toBeDisabled();
  });

  it('inserts a spacer row after each root+children group', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const childInput = await findCategoryNameInput('Alimentation');
    const parentRow = parent.closest('tr')!;
    const childRow = childInput.closest('tr')!;
    // parent → child → spacer (data-spacer="true", aria-hidden)
    const spacer = childRow.nextElementSibling as HTMLElement | null;
    expect(spacer).not.toBeNull();
    expect(spacer!.tagName).toBe('TR');
    expect(spacer!.getAttribute('data-spacer')).toBe('true');
    expect(spacer!.getAttribute('aria-hidden')).toBe('true');
    // Same for a root without children:
    void parentRow; // silence unused-var if lint complains
  });
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd frontend && npm test -- Categories.test.tsx --run`
Expected: the 4 new tests FAIL (handle button doesn't exist, spacer row doesn't exist).

- [ ] **Step 8: Add DnD to `Categories.tsx` — imports, sensors, and state**

At the top of `frontend/src/pages/Rules/Categories.tsx`, alongside the existing imports, add:

```tsx
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { resolveDrop, PROMOTE_DROP_ID, type DragTarget } from './dragNest';
```

Inside the `Categories` component, after the existing `del` mutation (around line 66), add sensors and drag state:

```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeDragId, setActiveDragId] = useState<number | null>(null);
```

Replace the existing `updateCategory` mutation (lines 42-51) with a version that adds `onMutate` optimistic rollback for `parentId` changes. Full replacement:

```tsx
  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api(`/api/categories/${id}`, { method: 'PUT', json: patch }),
    onMutate: async ({ id, patch }) => {
      // Only take a snapshot when the mutation touches parentId — that's the
      // path drag-and-drop uses; other patches are covered by the standard
      // invalidate-on-success and don't need optimistic rewriting.
      if (!Object.prototype.hasOwnProperty.call(patch, 'parentId')) return;
      await qc.cancelQueries({ queryKey: ['categories'] });
      const previous = qc.getQueryData<{ categories: Category[] }>(['categories']);
      if (previous) {
        const next = {
          categories: previous.categories.map((c) =>
            c.id === id ? { ...c, parentId: patch.parentId ?? null } : c,
          ),
        };
        qc.setQueryData(['categories'], next);
      }
      return { previous } as const;
    },
    onError: (err: ApiError, _vars, context) => {
      if (context?.previous) qc.setQueryData(['categories'], context.previous);
      setError(err.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
```

Add the drag handlers just below the `updateCategory` definition:

```tsx
  const onDragStart = (e: DragStartEvent) => {
    if (typeof e.active.id === 'number') setActiveDragId(e.active.id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || typeof active.id !== 'number') return;
    const target: DragTarget | null =
      over.id === PROMOTE_DROP_ID
        ? { kind: 'promote' }
        : typeof over.id === 'number'
          ? { kind: 'root', targetId: over.id }
          : null;
    const resolved = resolveDrop(active.id, target, cats);
    if (!resolved) return;
    updateCategory.mutate({ id: resolved.id, patch: { parentId: resolved.parentId } });
  };

  const onDragCancel = () => setActiveDragId(null);
```

- [ ] **Step 9: Wrap the table in `DndContext` and add the promote band**

Replace the current outer table container (line 177: `<div className="surface overflow-hidden">`) all the way to its closing `</div>` (line 231) with:

```tsx
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {activeDragId != null && <PromoteToRootBand />}
        <div className="surface overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b border-ink-800/70">
                  <th className="px-2 py-3 w-8" aria-hidden />
                  <th className="px-4 py-3 label font-normal">Nom</th>
                  <th className="px-4 py-3 label font-normal">Type</th>
                  <th
                    className="px-4 py-3 label font-normal hidden md:table-cell text-center"
                    title="Exclut la catégorie des moyennes mensuelles (dépenses/revenus). Utile pour marquer un mouvement interne — épargne, transfert entre comptes — sans passer par la détection automatique."
                  >
                    Interne
                  </th>
                  <th className="px-4 py-3 label font-normal hidden sm:table-cell">Couleur</th>
                  <th className="px-4 py-3 label font-normal text-right">Total (période chargée)</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {roots.flatMap((r) => {
                  const children = childrenByParent.get(r.id) ?? [];
                  const rows: JSX.Element[] = [
                    <CategoryTableRow
                      key={`root-${r.id}`}
                      c={r}
                      depth={0}
                      total={rolledUpTotal(r)}
                      hasChildren={children.length > 0}
                      parent={null}
                      childrenByParent={childrenByParent}
                      updateCategory={updateCategory}
                      onDelete={() => { setDeleteError(null); setConfirmDelete(r); }}
                    />,
                    ...children.map((ch) => (
                      <CategoryTableRow
                        key={`child-${ch.id}`}
                        c={ch}
                        depth={1}
                        total={ownTotalsByCat.get(ch.id) ?? 0}
                        hasChildren={false}
                        parent={r}
                        childrenByParent={childrenByParent}
                        updateCategory={updateCategory}
                        onDelete={() => { setDeleteError(null); setConfirmDelete(ch); }}
                      />
                    )),
                    <tr
                      key={`spacer-${r.id}`}
                      data-spacer="true"
                      aria-hidden="true"
                    >
                      <td colSpan={7} className="h-3" />
                    </tr>,
                  ];
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragId != null ? <DragGhost id={activeDragId} byId={byId} /> : null}
        </DragOverlay>
      </DndContext>
```

Note the changes vs. the original: leading empty `<th>` for the handle column, no "Parent" `<th>`, spacer `<tr>` per group, and the whole thing wrapped in `DndContext` with a `DragOverlay`.

- [ ] **Step 10: Add the `PromoteToRootBand` and `DragGhost` components at the bottom of the file**

At the very bottom of `Categories.tsx` (after `CategoryTableRow`), append:

```tsx
function PromoteToRootBand(): JSX.Element {
  const { isOver, setNodeRef } = useDroppable({ id: PROMOTE_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label="Déposez ici pour promouvoir en racine"
      className={
        `mb-3 rounded-md border border-dashed px-4 py-2.5 text-sm text-ink-400 text-center transition ` +
        (isOver
          ? 'border-sage-300 bg-sage-300/10 text-sage-200'
          : 'border-ink-700')
      }
    >
      Déposez ici pour promouvoir en catégorie racine
    </div>
  );
}

function DragGhost({
  id,
  byId,
}: {
  id: number;
  byId: Map<number, Category>;
}): JSX.Element | null {
  const c = byId.get(id);
  if (!c) return null;
  return (
    <div className="surface px-3 py-2 text-sm flex items-center gap-2 shadow-lg">
      {c.color && (
        <span
          className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
          style={{ backgroundColor: c.color }}
        />
      )}
      <span>{c.name}</span>
      <span className={kindBadgeClass(c.kind)}>{KIND_LABEL[c.kind]}</span>
    </div>
  );
}
```

- [ ] **Step 11: Add the drag handle to `CategoryTableRow`**

Modify `CategoryTableRow` — add `useDraggable` + `useDroppable` at the top of the function, and prepend a `<td>` with the handle button in the returned `<tr>`.

Immediately after `const { c, depth, total, hasChildren, parent, childrenByParent, updateCategory, onDelete } = props;`, add:

```tsx
  const dragDisabled = depth === 0 && hasChildren;
  const draggable = useDraggable({
    id: c.id,
    disabled: dragDisabled,
  });
  // Only root rows are drop targets for nesting.
  const droppable = useDroppable({
    id: c.id,
    disabled: depth === 1,
  });
```

Replace the opening `<tr>` (line 292-297) with a merged-ref pattern — a root row is both a draggable source AND a droppable target; a child row is only a source:

```tsx
  const setRowRef = (node: HTMLTableRowElement | null) => {
    droppable.setNodeRef(node);
  };

  const isValidDropTarget = depth === 0 && droppable.isOver && draggable.isDragging === false;

  return (
    <tr
      ref={setRowRef}
      data-depth={depth}
      className={
        `border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition ` +
        (depth === 1 ? 'bg-ink-900/20 ' : '') +
        (isValidDropTarget ? 'ring-2 ring-sage-300/60 ' : '') +
        (draggable.isDragging ? 'opacity-40' : '')
      }
    >
      <td className="pl-2 pr-1 py-2.5 w-8">
        <button
          ref={draggable.setActivatorNodeRef}
          type="button"
          disabled={dragDisabled}
          aria-label={`Déplacer la catégorie « ${c.name} »`}
          title={
            dragDisabled
              ? 'Cette catégorie a des sous-catégories — elle ne peut pas être imbriquée.'
              : undefined
          }
          className={
            `select-none text-ink-500 leading-none px-1 ` +
            (dragDisabled
              ? 'cursor-not-allowed opacity-30'
              : 'cursor-grab active:cursor-grabbing hover:text-ink-300')
          }
          {...draggable.attributes}
          {...draggable.listeners}
        >
          ⋮⋮
        </button>
      </td>
```

Then keep the existing `<td>` cells (Name, Type, Interne, Couleur, Total, delete) exactly as they are — except make sure the deleted Parent `<td>` from Task 2 is gone.

- [ ] **Step 12: Run all tests**

Run: `cd frontend && npm test -- Categories.test.tsx dragNest.test.ts --run`
Expected: every test passes, including the 4 new drag-handle / spacer tests.

- [ ] **Step 13: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 14: Manual smoke — start the dev server and drag things**

Run: `cd frontend && npm run dev`

Open the browser, log in, go to **Tri → Catégories**. Verify:

1. The create form has no Parent field.
2. Each row shows a `⋮⋮` handle at the left; grabbing a root without children and dragging it onto another root nests it. The child kind flips to the parent's kind after ~200ms (server-coerced + refetch).
3. Grabbing a child and dragging up over the "Déposez ici pour promouvoir en catégorie racine" band promotes it back to root.
4. Dragging the `⋮⋮` handle of a root that already has children does nothing — the handle is greyed with a tooltip.
5. Between each root+children group, there's a small vertical gap.
6. Dropping onto self or onto the current parent does nothing (no PUT fires — check devtools Network tab).

If everything looks right, stop the dev server.

- [ ] **Step 15: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add frontend/src/pages/Rules/Categories.tsx frontend/src/pages/Rules/__tests__/Categories.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): drag-and-drop nesting on the Categories screen

Drag a childless root onto another root to nest it as a sub-category; drag
a child onto the top "Promouvoir en racine" band (visible only during a
drag) to detach. Roots that already have children get a greyed handle with
a tooltip explaining the 2-level cap. Groups are separated by a small
spacer row for readability.

The kind coercion on nest is handled server-side (backend/src/http/routes/
categories.ts already does this), so no client-side confirm dialog.

Optimistic cache update on parentId changes rolls back on error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Task |
|---|---|
| Remove Parent field from create form | Task 1 |
| Remove Parent column from table | Task 2 |
| Drag handle per row | Task 3 (Step 11) |
| Greyed handle on root-with-children | Task 3 (Step 11) |
| Drop root onto root → nest | Task 3 (Steps 3, 9-11) |
| Drop above → promote back to root | Task 3 (Steps 3, 9-10) |
| Spacer row between groups | Task 3 (Step 9) |
| Kind coercion server-side, no client dialog | Task 3 mutation setup (Step 8) |
| Optimistic cache update + rollback | Task 3 (Step 8) |
| PointerSensor with distance: 4 | Task 3 (Step 8) |
| Keyboard sensor for a11y | Task 3 (Step 8) |
| French copy on tooltips & band | Task 3 (Steps 10, 11) |
| Tests for handle presence/disabled | Task 3 (Step 6) |
| Tests for resolveDrop edge cases | Task 3 (Step 1) |

**2. Placeholder scan:** No TBDs. Every code block is complete.

**3. Type consistency:**
- `DragTarget`, `PROMOTE_DROP_ID`, `resolveDrop` — declared in Task 3 Step 3, consumed in Task 3 Step 8.
- `CategoryTableRow` prop list — updated in Task 2 Step 3 to remove `roots`; Task 3 Step 11 doesn't re-add it.
- `updateCategory` mutation — Task 3 Step 8 replaces it wholesale with an `onMutate`-enabled version; the row still calls `.mutate(...)` the same way, so the swap is transparent to `CategoryTableRow`.

**4. Ambiguity:**
- In Step 11, the merged draggable+droppable ref pattern: the row uses `droppable.setNodeRef` for its `ref`; the drag activator is the handle button (via `draggable.setActivatorNodeRef`). The draggable's own `setNodeRef` (which would specify the "drag origin visual") isn't attached — we use `DragOverlay` for the ghost instead, so the origin row simply gets `opacity-40` via `draggable.isDragging`. This is explicit and correct.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-categories-drag-nest.md`. Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task, review checkpoint between tasks, fast iteration.

**2. Inline Execution** — run tasks in this session with executing-plans, batch checkpoints for review.

Which approach?
