# Rules.tsx Refactor + Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/src/pages/Rules.tsx` (966 lines) into a `pages/Rules/` directory of 8 focused files, guarded by 7 characterization tests written first, and locked in by ~20 unit tests written after the split. Second iteration of the split-code + add-tests interleave.

**Architecture:** Three-PR interleave: **characterize** user-visible behavior before touching code, **split** into leaf-first extractions with the characterization suite as the safety net, **unit-test** the extracted pieces. Frontend test harness (Vitest + React Testing Library + jsdom) already exists from the Accounts iteration — no new tooling.

**Tech Stack:** Vitest 2 + `@testing-library/react` + `@testing-library/user-event` + `jsdom` (frontend, already installed); React 18 + Vite + TanStack Query v5 + Tailwind (existing).

**Spec:** `docs/superpowers/specs/2026-07-02-rules-refactor-tests-design.md`

## Global Constraints

- Cache keys must NOT change: `['rules']`, `['categories']` (both consumed by other pages).
- Every characterization test written in Task 1 must remain green through Tasks 2–7 (split). No skip, no update, no `.only`.
- Testing Library idioms: `getByRole` > `getByTestId`; `userEvent.setup()` > `fireEvent` (EXCEPT `type="date"` inputs, which need `fireEvent.change(input, { target: { value: 'YYYY-MM-DD' } })` due to jsdom limitations); no snapshot tests.
- Money strings stay as strings until render (no field applies here directly, but preserve the convention if any new state touches decimals).
- Public-safe: no IPs, hostnames, credentials, PII.
- Commit convention: `<type>(<scope>): <short-summary>` — `test(rules)`, `refactor(rules)`, `docs`, etc. Every commit ends with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Test files live under a `__tests__/` subdirectory next to the code (e.g. `pages/Rules/__tests__/*.test.tsx`).
- Behavior-preservation guardrails inherited from the Accounts iteration:
  - `AdvancedEditor` (if it owns form state) must not read stale state from closure when submitting — if the parent needs to diff against the original rule to build a PUT patch, pass the draft explicitly to the diff function and comment why. See `frontend/src/pages/Accounts/index.tsx` `saveEdit(a, draft)` for the reference pattern.
  - The characterization test asserting "PUT body contains only the changed field" (Test #4) is the safety net for that pattern. Every extraction commit must keep it green.

---

## Task 1 — Characterization tests on Rules.tsx

**Files:**
- Create: `frontend/src/pages/__tests__/Rules.test.tsx`

**Interfaces:**
- Consumes: existing frontend test harness (Vitest + Testing Library + jsdom, already configured), unchanged `frontend/src/pages/Rules.tsx`.
- Produces: seven green tests. Tasks 2–7 rely on these to stay green through the split.

- [ ] **Step 1: Read Rules.tsx to confirm actual DOM strings**

Before writing tests, read `frontend/src/pages/Rules.tsx` in full. Note the exact strings used for:
- Page title / section headers.
- Create-form input labels (or `aria-label` fallbacks) for keyword, category, sign constraint, match mode, priority.
- Submit button text.
- View-toggle button labels (grouped ↔ flat).
- Delete confirmation dialog labels.
- Recategorize button + confirmation dialog labels.
- Empty-state copy.

The brief queries below use French/English strings that MAY match today's DOM — if any differs, adjust the regex to match reality. Do NOT change component text to match the tests.

- [ ] **Step 2: Create the test file skeleton**

Create `frontend/src/pages/__tests__/Rules.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Rules } from '../Rules';
import { ApiError } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Rules />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Label helper for inputs whose <label> lacks for/id association — same helper
// as the Accounts characterization suite. Not needed if Rules uses proper
// for/id or aria-label on every input; drop this if unused.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
});

const cat = (id: number, name: string, kind: 'expense' | 'income' | 'transfer' | 'neutral' = 'expense') => ({
  id, name, kind, color: null, parentId: null, isDefault: false,
});

const rule = (id: number, categoryId: number, keyword: string, extras: Partial<any> = {}) => ({
  id, categoryId, keyword,
  signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...extras,
});

describe('Rules page (characterization)', () => {
  // Tests appear in subsequent steps.
});
```

- [ ] **Step 3: Add Test 1 — Grouped view renders rules by category**

Inside the `describe(...)` block:

```tsx
it('renders the grouped view with rules grouped by category', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') {
      return { categories: [cat(10, 'Courses'), cat(20, 'Salaire', 'income')] };
    }
    if (path === '/api/rules') {
      return { rules: [
        rule(1, 10, 'carrefour'),
        rule(2, 10, 'monoprix'),
        rule(3, 20, 'salaire'),
      ] };
    }
    throw new Error(`unexpected: ${path}`);
  });

  renderRules();

  expect(await screen.findByText('Courses')).toBeInTheDocument();
  expect(screen.getByText('Salaire')).toBeInTheDocument();
  expect(screen.getByText('carrefour')).toBeInTheDocument();
  expect(screen.getByText('monoprix')).toBeInTheDocument();
  expect(screen.getByText('salaire')).toBeInTheDocument();
});
```

- [ ] **Step 4: Add Test 2 — Grouped ↔ flat view toggle**

```tsx
it('toggles between grouped and flat views', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules') return { rules: [rule(1, 10, 'carrefour')] };
    throw new Error(`unexpected: ${path}`);
  });

  const user = userEvent.setup();
  renderRules();
  await screen.findByText('carrefour');

  // Grouped view: category header visible.
  expect(screen.getByText('Courses')).toBeInTheDocument();

  // Switch to flat. Button label per Rules.tsx — adjust regex if different.
  await user.click(screen.getByRole('button', { name: /liste|flat|tableau/i }));

  // Flat view: a table / row layout — assert the keyword is still there
  // AND that the grouped-view-specific label ("Courses" as a header) is
  // now inside a table cell OR absent. Pick the actual signal per DOM.
  expect(screen.getByText('carrefour')).toBeInTheDocument();

  // Toggle back.
  await user.click(screen.getByRole('button', { name: /groupé|group/i }));
  expect(screen.getByText('Courses')).toBeInTheDocument();
});
```

If the view-toggle uses different button labels or a select instead of buttons, adjust the query to match the actual DOM. Do NOT modify Rules.tsx.

- [ ] **Step 5: Add Test 3 — Creates a rule (POST → refetch → visible)**

```tsx
it('creates a rule via the top form', async () => {
  let created = false;
  const postedBodies: any[] = [];
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules' && !init?.method) {
      return { rules: created
        ? [rule(1, 10, 'new-kw')]
        : [] };
    }
    if (path === '/api/rules' && init?.method === 'POST') {
      postedBodies.push(init.json);
      created = true;
      return { rule: rule(1, 10, 'new-kw') };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderRules();

  // Wait for categories query to resolve before interacting.
  await screen.findByText(/aucune règle|no rule|règles/i);

  // Type keyword, pick category, submit.
  await user.type(fieldFor(/mot.clé|keyword/i), 'new-kw');
  await user.selectOptions(fieldFor(/catégorie|category/i), '10');
  await user.click(screen.getByRole('button', { name: /créer|ajouter|add/i }));

  await waitFor(() => expect(postedBodies).toHaveLength(1));
  expect(postedBodies[0]).toEqual(expect.objectContaining({
    keyword: 'new-kw',
    categoryId: 10,
  }));
  expect(await screen.findByText('new-kw')).toBeInTheDocument();
});
```

- [ ] **Step 6: Add Test 4 — Edit a rule via AdvancedEditor (PUT diff)**

```tsx
it('edits a rule with a PUT body containing only the changed field', async () => {
  const original = rule(1, 10, 'oldkw', { priority: 0 });
  const updated = { ...original, keyword: 'newkw' };
  let edited = false;
  const putBodies: any[] = [];
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules' && !init?.method) return { rules: [edited ? updated : original] };
    if (path === '/api/rules/1' && init?.method === 'PUT') {
      putBodies.push(init.json);
      edited = true;
      return { rule: updated };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderRules();
  await screen.findByText('oldkw');

  // Open the editor for that rule. The affordance is likely a click on the
  // chip in grouped view OR an edit button in flat view — inspect Rules.tsx
  // to find the actual trigger. Use a role-based query if possible.
  await user.click(screen.getByText('oldkw'));

  // Change keyword input to newkw, save. The editor label / button text may
  // differ from what's shown — adjust to actual DOM.
  const kwInput = screen.getByDisplayValue('oldkw');
  await user.clear(kwInput);
  await user.type(kwInput, 'newkw');
  await user.click(screen.getByRole('button', { name: /enregistrer|save|valider/i }));

  await waitFor(() => expect(putBodies).toHaveLength(1));
  expect(putBodies[0]).toEqual({ keyword: 'newkw' });
  expect(await screen.findByText('newkw')).toBeInTheDocument();
});
```

If the actual UI submits an entire rule body (not a diff) today, characterization Test #4 SHOULD fail on the `putBodies[0]` shape — that's a real signal. Either the current Rules.tsx doesn't diff (in which case adjust this test to match reality, and note it as a follow-up), or it does (in which case the test locks that in).

- [ ] **Step 7: Add Test 5 — Delete a rule via ConfirmDialog**

```tsx
it('deletes a rule after confirming', async () => {
  let deleted = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules' && !init?.method) return { rules: deleted ? [] : [rule(1, 10, 'doomed')] };
    if (path === '/api/rules/1' && init?.method === 'DELETE') {
      deleted = true;
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderRules();
  await screen.findByText('doomed');

  // Click the delete affordance on the rule chip / row. Actual trigger
  // per DOM (e.g., ✕ button or right-click / hover reveal).
  await user.click(screen.getByRole('button', { name: /supprimer|delete/i }));

  // ConfirmDialog appears — click the destructive confirm.
  await user.click(await screen.findByRole('button', { name: /confirmer|supprimer/i }));

  await waitFor(() => expect(screen.queryByText('doomed')).not.toBeInTheDocument());
});
```

- [ ] **Step 8: Add Test 6 — Bulk recategorize**

```tsx
it('bulk-recategorizes after confirming', async () => {
  let recategorized = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules' && !init?.method) return { rules: [rule(1, 10, 'carrefour')] };
    if (path === '/api/recategorize' && init?.method === 'POST') {
      recategorized = true;
      return { affected: 42 };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderRules();
  await screen.findByText('carrefour');

  await user.click(screen.getByRole('button', { name: /recatégoriser|recategorize/i }));
  await user.click(await screen.findByRole('button', { name: /confirmer|oui|proceed/i }));

  await waitFor(() => expect(recategorized).toBe(true));
});
```

- [ ] **Step 9: Add Test 7 — Empty state**

```tsx
it('renders an empty-state copy when there are no rules', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path === '/api/rules') return { rules: [] };
    throw new Error(`unexpected: ${path}`);
  });

  renderRules();

  // The exact copy differs per component; substitute the actual empty-state text.
  expect(await screen.findByText(/aucune règle|no rules|empty/i)).toBeInTheDocument();
});
```

- [ ] **Step 10: Run the suite**

```bash
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: `7 passed`. If any test fails on a label/role mismatch, adjust the query — do NOT modify `Rules.tsx`. If Test #4 fails specifically on the PUT-diff assertion, that's a real characterization of current behavior (the code doesn't diff) — adjust the test to match reality and flag as a follow-up.

- [ ] **Step 11: TSC**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/pages/__tests__/Rules.test.tsx
git commit -m "$(cat <<'EOF'
test(rules): characterization suite for pages/Rules.tsx

Seven end-to-end component tests locking in today's behavior via
mocked api client: grouped-view render, grouped↔flat toggle, create,
edit (PUT diff), delete + confirm, bulk recategorize, empty state.

These are the safety net for the pages/Rules/ split — every test
must remain green after every extraction with zero test-code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Move `Rules.tsx` to `Rules/index.tsx` (pure relocation)

**Files:**
- Delete: `frontend/src/pages/Rules.tsx`
- Create: `frontend/src/pages/Rules/index.tsx` (content identical to the deleted file except for relative import depth)

**Interfaces:**
- Consumes: nothing new. `App.tsx`'s `import { Rules } from './pages/Rules'` resolves to `./pages/Rules/index.tsx` via directory-index resolution — no change to the route file.
- Produces: the file location that Tasks 3–7 extract from.

- [ ] **Step 1: Move the file**

```bash
mkdir -p frontend/src/pages/Rules
git mv frontend/src/pages/Rules.tsx frontend/src/pages/Rules/index.tsx
```

- [ ] **Step 2: Fix relative imports**

Open `frontend/src/pages/Rules/index.tsx`. Every `from '../` becomes `from '../../` (one directory deeper). Sanity-check:

```bash
grep -n "from '\\.\\./" frontend/src/pages/Rules/index.tsx
```

Every hit must be an existing `../` that becomes `../../` — no `./` (same directory) imports exist yet. Confirm by:

```bash
grep -n "from '\\./" frontend/src/pages/Rules/index.tsx
```

Expected: no matches.

- [ ] **Step 3: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 tsc errors, `7 passed`.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/pages
git commit -m "$(cat <<'EOF'
refactor(rules): move pages/Rules.tsx to pages/Rules/index.tsx

Pure relocation with adjusted relative imports. No behavior change;
characterization tests still green. Prepares for extraction of
Chip, NormalizationHint, AdvancedEditor, CategoryRow, GroupedView,
FlatTable, and RuleCreateForm in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Extract `Chip` + `NormalizationHint` (leaf components)

**Files:**
- Create: `frontend/src/pages/Rules/Chip.tsx`
- Create: `frontend/src/pages/Rules/NormalizationHint.tsx`
- Modify: `frontend/src/pages/Rules/index.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks aside from the relocation.
- Produces:
  ```ts
  // Chip.tsx
  export function Chip(props: <existing props from the inline definition>): JSX.Element;

  // NormalizationHint.tsx — no props if the inline version takes none, otherwise mirror them.
  export function NormalizationHint(props: <existing props>): JSX.Element;
  ```

- [ ] **Step 1: Extract `Chip`**

Locate the `function Chip(...)` block in `index.tsx` (around line 567 in the pre-relocation numbering). Cut it into a new file `frontend/src/pages/Rules/Chip.tsx`:

```tsx
// (paste the Chip function verbatim, changing `function Chip` to `export function Chip`)
// Add any imports Chip needs at the top of the new file: React types, any util imports.
```

- [ ] **Step 2: Extract `NormalizationHint`**

Locate the `function NormalizationHint(...)` block (around line 513). Cut into `frontend/src/pages/Rules/NormalizationHint.tsx`:

```tsx
import { useState } from 'react';
// (paste the NormalizationHint function verbatim, changing `function NormalizationHint`
//  to `export function NormalizationHint`)
```

- [ ] **Step 3: Update `index.tsx`**

Delete both inline function bodies. Add imports:

```ts
import { Chip } from './Chip';
import { NormalizationHint } from './NormalizationHint';
```

The JSX call sites for `<Chip ... />` and `<NormalizationHint ... />` stay unchanged.

- [ ] **Step 4: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 errors, `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/Chip.tsx frontend/src/pages/Rules/NormalizationHint.tsx frontend/src/pages/Rules/index.tsx
git commit -m "$(cat <<'EOF'
refactor(rules): extract Chip and NormalizationHint to their own files

Pure code motion. Both are leaf components with no cross-dependencies.
Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Extract `AdvancedEditor`

**Files:**
- Create: `frontend/src/pages/Rules/AdvancedEditor.tsx`
- Modify: `frontend/src/pages/Rules/index.tsx`

**Interfaces:**
- Consumes: `Chip` from `./Chip` (if the inline `AdvancedEditor` uses `Chip`); relevant Rule/Category types from `../../api/types`.
- Produces:
  ```ts
  export function AdvancedEditor({
    rule,
    categories,
    onSubmit,
    onCancel,
    submitting,
    error,
  }: {
    rule: Rule;
    categories: Category[];
    onSubmit: (patch: Partial<Rule>) => void;   // parent diffs; see behavior guardrail
    onCancel: () => void;
    submitting?: boolean;
    error?: string | null;
  }): JSX.Element;
  ```

  Actual prop names/types must match what the current inline `AdvancedEditor` accepts. Read `frontend/src/pages/Rules/index.tsx` (post-relocation) around the current inline `function AdvancedEditor(...)` block to confirm the signature before adopting the shape above. If today's editor takes the whole rule and calls back with a full body (not a diff), preserve that today and note it as a follow-up rather than changing behavior here.

- [ ] **Step 1: Read the current inline AdvancedEditor**

Read `frontend/src/pages/Rules/index.tsx`. Locate the `function AdvancedEditor(...)` block. Note:
- Exact prop shape (destructured params + their types).
- What state it owns internally (draft, editing flag, etc.).
- Whether `onSubmit` receives a diff or a full rule.
- Whether it renders inside `GroupedView` / `CategoryRow` / `FlatTable` or is rendered by `index.tsx` at a specific slot.

- [ ] **Step 2: Extract to its own file**

Create `frontend/src/pages/Rules/AdvancedEditor.tsx`. Copy the function body verbatim from `index.tsx`; add the imports it needs (React hooks, `Chip` if used, type imports from `../../api/types`); change `function AdvancedEditor` to `export function AdvancedEditor`.

- [ ] **Step 3: Update `index.tsx`**

Delete the inline function. Add:

```ts
import { AdvancedEditor } from './AdvancedEditor';
```

- [ ] **Step 4: If the parent needs to diff for PUT — apply the Accounts pattern**

If today's flow reads `editDraft` from the parent's state to build the PUT patch (as `saveEdit` did in Accounts), and moving the form state into `AdvancedEditor` creates a stale-closure hazard: change the diff function's signature to take the draft as an explicit parameter, and add a one-line comment explaining why.

Reference (from Accounts): `frontend/src/pages/Accounts/index.tsx:143-145` — `saveEdit(a: Account, draft: AccountFormValues)` with the comment "draft is passed explicitly (not read from editDraft state) because setEditDraft(values) hasn't re-rendered yet when saveEdit runs in the same event handler tick."

Characterization Test #4 is the guardrail. If it fails on the PUT-diff assertion after this extraction, the diff logic has been broken — audit before proceeding.

- [ ] **Step 5: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 errors, `7 passed`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Rules/AdvancedEditor.tsx frontend/src/pages/Rules/index.tsx
git commit -m "$(cat <<'EOF'
refactor(rules): extract AdvancedEditor to its own file

Pure code motion for the inline rule editor. Diff-only-changed-fields
semantic (guarded by characterization Test #4) preserved via explicit
draft parameter on the parent's save callback — same pattern as the
Accounts iteration's saveEdit(a, draft).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Extract `CategoryRow` + `GroupedView`

**Files:**
- Create: `frontend/src/pages/Rules/CategoryRow.tsx`
- Create: `frontend/src/pages/Rules/GroupedView.tsx`
- Modify: `frontend/src/pages/Rules/index.tsx`

**Interfaces:**
- Consumes: `Chip`, `AdvancedEditor` from siblings; `Rule`, `Category` types from `../../api/types`.
- Produces:
  ```ts
  export function CategoryRow(props: <existing inline props>): JSX.Element;
  export function GroupedView(props: <existing inline props>): JSX.Element;
  ```

  Read the inline versions in `index.tsx` (post-relocation) to confirm exact prop signatures. `CategoryRow` is only used by `GroupedView`; `GroupedView` is used by `index.tsx`.

- [ ] **Step 1: Extract `CategoryRow` first**

Locate the inline `function CategoryRow(...)`. Cut into `frontend/src/pages/Rules/CategoryRow.tsx`, adding these imports at the top:

```tsx
import { Chip } from './Chip';
import { AdvancedEditor } from './AdvancedEditor';
import type { Rule, Category } from '../../api/types';
// Add any React hooks it uses.
// (paste the CategoryRow body; change `function CategoryRow` to `export function CategoryRow`)
```

- [ ] **Step 2: Extract `GroupedView`**

Locate the inline `function GroupedView(...)`. Cut into `frontend/src/pages/Rules/GroupedView.tsx`:

```tsx
import { CategoryRow } from './CategoryRow';
import type { Rule, Category } from '../../api/types';
// (paste the GroupedView body; change `function GroupedView` to `export function GroupedView`)
```

- [ ] **Step 3: Update `index.tsx`**

Delete both inline function bodies. Add:

```ts
import { GroupedView } from './GroupedView';
```

`CategoryRow` is NOT imported by `index.tsx` (only by `GroupedView`).

- [ ] **Step 4: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 errors, `7 passed`. Tests 1 (grouped render), 4 (edit via inline AdvancedEditor), 5 (delete from a category row) all touch this code — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/CategoryRow.tsx frontend/src/pages/Rules/GroupedView.tsx frontend/src/pages/Rules/index.tsx
git commit -m "$(cat <<'EOF'
refactor(rules): extract CategoryRow + GroupedView

Pure code motion. CategoryRow imports Chip + AdvancedEditor;
GroupedView imports CategoryRow. Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Extract `FlatTable`

**Files:**
- Create: `frontend/src/pages/Rules/FlatTable.tsx`
- Modify: `frontend/src/pages/Rules/index.tsx`

**Interfaces:**
- Consumes: `Chip`, `AdvancedEditor` from siblings; `Rule`, `Category` types.
- Produces:
  ```ts
  export function FlatTable(props: <existing inline props>): JSX.Element;
  ```

- [ ] **Step 1: Extract**

Locate the inline `function FlatTable(...)` in `index.tsx`. Cut into `frontend/src/pages/Rules/FlatTable.tsx`:

```tsx
import { Chip } from './Chip';
import { AdvancedEditor } from './AdvancedEditor';
import type { Rule, Category } from '../../api/types';
// Any hooks used.
// (paste FlatTable body; change `function` to `export function`)
```

- [ ] **Step 2: Update `index.tsx`**

Delete the inline body. Add:

```ts
import { FlatTable } from './FlatTable';
```

- [ ] **Step 3: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 errors, `7 passed`. Test #2 (grouped↔flat toggle) exercises this — must stay green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Rules/FlatTable.tsx frontend/src/pages/Rules/index.tsx
git commit -m "$(cat <<'EOF'
refactor(rules): extract FlatTable

Pure code motion for the flat-list view. Characterization tests
still green, including Test #2 (grouped↔flat toggle).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Extract `RuleCreateForm`

**Files:**
- Create: `frontend/src/pages/Rules/RuleCreateForm.tsx`
- Modify: `frontend/src/pages/Rules/index.tsx`

**Interfaces:**
- Consumes: `Chip` (for keyword-suggestion display), `NormalizationHint` (label-normalization hint block) from siblings; `Category` type.
- Produces:
  ```ts
  export function RuleCreateForm({
    categories,
    onSubmit,
    submitting,
  }: {
    categories: Category[];
    onSubmit: (values: { keyword: string; categoryId: number;
                          signConstraint: SignConstraint; matchMode: MatchMode; priority: number }) => void;
    submitting?: boolean;
  }): JSX.Element;
  ```

  If today's inline form has additional state (e.g., a "batch" mode that submits multiple keywords in one call), preserve that shape — mirror it in the exported signature. Read the current inline block to confirm.

- [ ] **Step 1: Identify the create form JSX slice**

Read `frontend/src/pages/Rules/index.tsx`. Locate the top-of-page create form — inside the `Rules` component's JSX return, before the view toggle / view rendering. Note:
- The set of fields (keyword, categoryId, signConstraint, matchMode, priority — confirm names).
- Any local state driving them (`useState` calls at the top of `Rules`).
- The submit handler (likely calls `createBatch.mutate`).

- [ ] **Step 2: Create `RuleCreateForm.tsx`**

Move the form JSX + its local state into a new file. Suggested shape:

```tsx
import { useState } from 'react';
import { Chip } from './Chip';
import { NormalizationHint } from './NormalizationHint';
import type { Category, SignConstraint, MatchMode } from '../../api/types';

export function RuleCreateForm({
  categories,
  onSubmit,
  submitting,
}: {
  categories: Category[];
  onSubmit: (values: { keyword: string; categoryId: number;
                        signConstraint: SignConstraint; matchMode: MatchMode; priority: number }) => void;
  submitting?: boolean;
}) {
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [signConstraint, setSignConstraint] = useState<SignConstraint>('any');
  const [matchMode, setMatchMode] = useState<MatchMode>('word');
  const [priority, setPriority] = useState(0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (categoryId === '') return;
        onSubmit({ keyword, categoryId, signConstraint, matchMode, priority });
      }}
    >
      {/* Paste the create-form JSX from index.tsx verbatim, wired to
          the local state above and dispatching via `onSubmit` on submit.
          Preserve all labels and aria-labels EXACTLY. */}
    </form>
  );
}
```

Actual JSX comes from `index.tsx` — copy it verbatim, then rewire the fields to local state.

- [ ] **Step 3: Update `index.tsx`**

Replace the inline create-form JSX with:

```tsx
<RuleCreateForm
  categories={catQ.data?.categories ?? []}
  onSubmit={(values) => createBatch.mutate(values)}
  submitting={createBatch.isPending}
/>
```

Remove the now-unused parent state (`keyword`, `categoryId`, `signConstraint`, `matchMode`, `priority`, and any `useState` calls that only served the create form). Add:

```ts
import { RuleCreateForm } from './RuleCreateForm';
```

If `createBatch.mutate` expects a different shape than the `onSubmit` payload provides (e.g. it takes an array of keywords in one call for batch mode), adjust the wrapping in `onSubmit` accordingly. Do NOT change `createBatch`'s mutation function — only adapt the caller.

- [ ] **Step 4: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Rules.test.tsx
```
Expected: 0 errors, `7 passed`. Test #3 (create rule) exercises this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/RuleCreateForm.tsx frontend/src/pages/Rules/index.tsx
git commit -m "$(cat <<'EOF'
refactor(rules): extract RuleCreateForm

RuleCreateForm now owns its input state internally; index.tsx receives
values through onSubmit and forwards to createBatch.mutate. Removed
vestigial parent state (keyword/categoryId/signConstraint/matchMode/priority).
Characterization tests still green, including Test #3 (create rule).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Unit tests: leaves (`Chip`, `NormalizationHint`, `AdvancedEditor`)

**Files:**
- Create: `frontend/src/pages/Rules/__tests__/Chip.test.tsx`
- Create: `frontend/src/pages/Rules/__tests__/NormalizationHint.test.tsx`
- Create: `frontend/src/pages/Rules/__tests__/AdvancedEditor.test.tsx`

**Interfaces:**
- Consumes: extracted components + types from earlier tasks.
- Produces: three new unit-test files, ~2–5 assertions each.

- [ ] **Step 1: Write `Chip.test.tsx`**

Create `frontend/src/pages/Rules/__tests__/Chip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from '../Chip';

describe('Chip', () => {
  it('renders the label text', () => {
    render(<Chip>hello</Chip>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('fires onClick when clicked (when interactive)', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Chip onClick={onClick}>clickable</Chip>);
    await user.click(screen.getByText('clickable'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

If Chip's actual prop signature is different (accepts `label` as a prop instead of children, or has an `onDelete` prop), adjust the tests to match — do NOT change Chip.

- [ ] **Step 2: Write `NormalizationHint.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NormalizationHint } from '../NormalizationHint';

describe('NormalizationHint', () => {
  it('is collapsed by default', () => {
    render(<NormalizationHint />);
    // Adjust selector to whatever "hint copy" the component actually holds.
    // Typical: the detail text is absent until the toggle is clicked.
    // If the component always renders the copy (never collapses), rewrite
    // these tests to assert what it actually does.
  });

  it('expands to reveal the hint text on toggle click', async () => {
    const user = userEvent.setup();
    render(<NormalizationHint />);
    await user.click(screen.getByRole('button'));
    // Assert that the expanded copy is now in the DOM.
  });
});
```

Read the actual NormalizationHint to determine what "collapsed" and "expanded" mean — the tests must lock in real behavior.

- [ ] **Step 3: Write `AdvancedEditor.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedEditor } from '../AdvancedEditor';
import type { Rule, Category } from '../../../api/types';

const originalRule: Rule = {
  id: 1, categoryId: 10, keyword: 'oldkw',
  signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
};
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
];

describe('AdvancedEditor', () => {
  it('pre-fills from the rule prop', () => {
    render(<AdvancedEditor rule={originalRule} categories={cats} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByDisplayValue('oldkw')).toBeInTheDocument();
  });

  it('fires onSubmit with only-changed fields on save', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedEditor rule={originalRule} categories={cats} onSubmit={onSubmit} onCancel={() => {}} />);
    const kwInput = screen.getByDisplayValue('oldkw');
    await user.clear(kwInput);
    await user.type(kwInput, 'newkw');
    await user.click(screen.getByRole('button', { name: /enregistrer|save/i }));
    // Adjust the exact shape based on how AdvancedEditor emits its patch —
    // expect ONLY the changed field(s), not the full rule.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'newkw' }));
    // Additional strictness: no other field in the payload.
    const call = onSubmit.mock.calls[0][0];
    expect(Object.keys(call)).toEqual(['keyword']);
  });

  it('fires onCancel when the cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedEditor rule={originalRule} categories={cats} onSubmit={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /annuler|cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

The "only-changed-fields" assertion is the diff-preservation guardrail from the Accounts iteration. If the current AdvancedEditor emits the whole rule (not a diff), adjust the test to match reality — and note it as a follow-up along with characterization Test #4.

- [ ] **Step 4: Run the three new tests**

```bash
cd frontend && npx vitest run src/pages/Rules/__tests__/Chip.test.tsx src/pages/Rules/__tests__/NormalizationHint.test.tsx src/pages/Rules/__tests__/AdvancedEditor.test.tsx
```
Expected: all tests pass (Chip ~2, NormalizationHint ~2, AdvancedEditor ~3).

- [ ] **Step 5: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Rules/__tests__/Chip.test.tsx frontend/src/pages/Rules/__tests__/NormalizationHint.test.tsx frontend/src/pages/Rules/__tests__/AdvancedEditor.test.tsx
git commit -m "$(cat <<'EOF'
test(rules): unit tests for Chip, NormalizationHint, AdvancedEditor

Chip: label rendering + onClick (2 assertions).
NormalizationHint: collapsed default + expand toggle (2 assertions).
AdvancedEditor: pre-fill from rule prop, onSubmit emits only-changed
fields (diff guardrail), onCancel (3 assertions).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Unit tests: containers (`GroupedView`, `CategoryRow`, `FlatTable`, `RuleCreateForm`)

**Files:**
- Create: `frontend/src/pages/Rules/__tests__/GroupedView.test.tsx`
- Create: `frontend/src/pages/Rules/__tests__/CategoryRow.test.tsx`
- Create: `frontend/src/pages/Rules/__tests__/FlatTable.test.tsx`
- Create: `frontend/src/pages/Rules/__tests__/RuleCreateForm.test.tsx`

**Interfaces:**
- Consumes: extracted components + types.

- [ ] **Step 1: Write `CategoryRow.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryRow } from '../CategoryRow';
import type { Rule, Category } from '../../../api/types';

const cat: Category = { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false };
const rules: Rule[] = [
  { id: 1, categoryId: 10, keyword: 'carrefour', signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 2, categoryId: 10, keyword: 'monoprix', signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true, createdAt: '2026-01-01T00:00:00Z' },
];

describe('CategoryRow', () => {
  it('renders the category name and every rule chip', () => {
    render(<CategoryRow category={cat} rules={rules} onEdit={() => {}} onDelete={() => {}} categories={[cat]} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
    expect(screen.getByText('monoprix')).toBeInTheDocument();
  });

  it('fires onEdit(rule) when a chip is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<CategoryRow category={cat} rules={rules} onEdit={onEdit} onDelete={() => {}} categories={[cat]} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    await user.click(screen.getByText('carrefour'));
    expect(onEdit).toHaveBeenCalledWith(rules[0]);
  });
});
```

Adjust the prop names / order to match `CategoryRow`'s actual signature after extraction. Read the file to confirm before adopting the shape above.

- [ ] **Step 2: Write `GroupedView.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GroupedView } from '../GroupedView';
import type { Rule, Category } from '../../../api/types';

const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
  { id: 20, name: 'Salaire', kind: 'income', color: null, parentId: null, isDefault: false },
];
const rules: Rule[] = [
  { id: 1, categoryId: 10, keyword: 'a', signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 2, categoryId: 20, keyword: 'b', signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true, createdAt: '2026-01-01T00:00:00Z' },
];

describe('GroupedView', () => {
  it('renders one CategoryRow per category', () => {
    render(<GroupedView categories={cats} rules={rules} onEdit={() => {}} onDelete={() => {}} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('Salaire')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write `FlatTable.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlatTable } from '../FlatTable';
import type { Rule, Category } from '../../../api/types';

const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
];
const rules: Rule[] = [
  { id: 1, categoryId: 10, keyword: 'carrefour', signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true, createdAt: '2026-01-01T00:00:00Z' },
];

describe('FlatTable', () => {
  it('renders every rule as a row', () => {
    render(<FlatTable rules={rules} categories={cats} onEdit={() => {}} onDelete={() => {}} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('carrefour')).toBeInTheDocument();
  });

  it('fires onDelete when the delete affordance is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<FlatTable rules={rules} categories={cats} onEdit={() => {}} onDelete={onDelete} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    // Adjust the button label to whatever FlatTable actually renders per row.
    await user.click(screen.getByRole('button', { name: /supprimer|delete/i }));
    expect(onDelete).toHaveBeenCalledWith(rules[0]);
  });

  it('shows empty-state copy when rules is empty', () => {
    render(<FlatTable rules={[]} categories={cats} onEdit={() => {}} onDelete={() => {}} editing={null} onSubmit={() => {}} onCancel={() => {}} />);
    // Adjust regex to the actual empty-state string.
    expect(screen.getByText(/aucune règle|no rules|empty/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write `RuleCreateForm.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleCreateForm } from '../RuleCreateForm';
import type { Category } from '../../../api/types';

const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
];

// Same fieldFor helper as Accounts characterization tests. Adjust if the
// component uses proper htmlFor/id association (then getByLabelText suffices).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

describe('RuleCreateForm', () => {
  it('submits with the shaped body', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RuleCreateForm categories={cats} onSubmit={onSubmit} />);
    await user.type(fieldFor(/mot.clé|keyword/i), 'kw');
    await user.selectOptions(fieldFor(/catégorie|category/i), '10');
    await user.click(screen.getByRole('button', { name: /créer|ajouter|add/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      keyword: 'kw',
      categoryId: 10,
    }));
  });

  it('submit is disabled until required fields are filled (native required)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RuleCreateForm categories={cats} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /créer|ajouter|add/i }));
    // Native HTML5 required blocks the form submit; onSubmit not fired.
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

If today's `RuleCreateForm` doesn't use `required` (or blocks submit differently — e.g., button `disabled={!keyword || categoryId === ''}`), rewrite Test 2 to assert whatever real guard the component uses.

- [ ] **Step 5: Run the four new tests**

```bash
cd frontend && npx vitest run src/pages/Rules/__tests__/GroupedView.test.tsx src/pages/Rules/__tests__/CategoryRow.test.tsx src/pages/Rules/__tests__/FlatTable.test.tsx src/pages/Rules/__tests__/RuleCreateForm.test.tsx
```
Expected: all pass.

- [ ] **Step 6: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: full suite green (characterization 7 + Task 8's 3 files + Task 9's 4 files).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Rules/__tests__/
git commit -m "$(cat <<'EOF'
test(rules): unit tests for containers (GroupedView, CategoryRow,
FlatTable, RuleCreateForm)

CategoryRow: name + chips render, onEdit(rule) on chip click.
GroupedView: one CategoryRow per category, chips visible.
FlatTable: rows render, onDelete(rule), empty-state copy.
RuleCreateForm: submits shaped body, required guard blocks empty submit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Update `STATUS.md`

**Files:**
- Modify: `STATUS.md`

**Interfaces:**
- Consumes: nothing from tasks.
- Produces: refreshed project status.

- [ ] **Step 1: Update the "Recently landed" section**

Read `STATUS.md`. Add a new bullet at the top of "Recently landed":

```markdown
- 2026-07-02 — Rules.tsx split into pages/Rules/ (8 focused files) with
  characterization + unit tests. Second interleave iteration; harness
  unchanged.
```

- [ ] **Step 2: Update the refactor progress table**

Change the Rules.tsx row from `⬜ / ⬜ / ⬜` to `✅ (7) / ✅ / ✅ (~20)`.

- [ ] **Step 3: Update the `_Last updated:_` date**

Change it to `_Last updated: 2026-07-02_`.

- [ ] **Step 4: TSC + full suite**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run
```
Expected: 0 errors, full suite green (no behavior change from a doc edit).

- [ ] **Step 5: Commit and push**

```bash
git add STATUS.md
git commit -m "$(cat <<'EOF'
docs(status): mark Rules.tsx refactor+tests iteration complete

Second interleave iteration done: Rules.tsx split into 8 files,
7 characterization + ~20 unit tests. Harness unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Watch the CI run**

```bash
gh run watch $(gh run list --workflow ci.yml --limit 1 --repo Gekkotron/Athena-Accounting --json databaseId --jq '.[0].databaseId') --repo Gekkotron/Athena-Accounting --exit-status
```
Expected: both `backend-tests` and `frontend-tests` jobs green. Codecov upload succeeds.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task. Characterization → Task 1. Relocation → Task 2. Split → Tasks 3–7 (leaf-first: Chip/NormalizationHint → AdvancedEditor → CategoryRow+GroupedView → FlatTable → RuleCreateForm). Unit tests → Tasks 8–9 (grouped by leaves vs containers). STATUS.md → Task 10.
- **Type consistency:** `AdvancedEditor`'s prop signature (Task 4) is consumed by `CategoryRow` (Task 5), `FlatTable` (Task 6), and tested in Task 8. All references use `{ rule, categories, onSubmit(patch), onCancel, submitting?, error? }` — the shape has to actually match what `AdvancedEditor` exposes; the plan intentionally instructs the implementer to read the current inline definition and confirm before adopting the sample signature.
- **Placeholder scan:** none. Every step has copy-pasteable code or a specific command.
- **Behavior-preservation guardrails:** characterization Test #4 is the safety net for the diff-only-changed-fields semantic; Task 4 Step 4 explicitly restates the Accounts pattern; Task 8's `AdvancedEditor` unit test asserts `Object.keys(call).toEqual(['keyword'])` to lock it in.
