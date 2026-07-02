# Imports.tsx Refactor + Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/src/pages/Imports.tsx` (787 lines, monolithic) into `pages/Imports/` (6 focused files), guarded by 7 characterization tests written first + ~20 unit tests written after. Fourth iteration of the interleave.

**Architecture:** Same three-scope shape as Accounts, Rules, Transactions: characterize behavior FIRST, split leaf-first with the characterization suite as safety net, unit-test the pieces after. Frontend test harness unchanged.

**Tech Stack:** Vitest 2 + `@testing-library/react` + `@testing-library/user-event` + `jsdom`; React 18 + Vite + TanStack Query v5.

**Spec:** `docs/superpowers/specs/2026-07-02-imports-refactor-tests-design.md`

## Global Constraints

- Cache keys must NOT change: `['imports']`, `['dups']`, `['accounts']`.
- Every characterization test written in Task 1 must remain green through Tasks 2–7 (split). No skip, no update, no `.only`.
- Testing Library idioms: `getByRole` > `getByTestId`; `userEvent.setup()` > `fireEvent` EXCEPT `type="date"` inputs.
- No production behavior changes outside the split.
- File uploads: `apiUpload(path, file, opts?)` from `frontend/src/api/client.ts` — separate from `api<T>`. Tests need to mock it too (either via `vi.mock('../../api/client')` covering both exports, or a shared mock module).
- Pending-import handoff (`pendingImport`, `needsTpl`, `lastImported`, `pdfPending`) stays in `index.tsx`. `UploadForm` writes; `PdfTemplateWizard` reads.
- Callback closure semantics: any callback that reads state at submit-time passes the value explicitly (pattern from Rules `saveEdit(a, draft)` / Transactions `TransactionRow`).
- `components/PdfTemplateBuilder/` untouched — only the orchestration around it moves.
- Public-safe: no PII / IPs / hostnames.
- Commit convention: `<type>(<scope>): <summary>` — `test(imports)`, `refactor(imports)`, `docs(status)`. Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Test files under a `__tests__/` subdirectory next to code.

---

## Task 1 — Characterization tests on Imports.tsx

**Files:**
- Create: `frontend/src/pages/__tests__/Imports.test.tsx`

**Interfaces:**
- Consumes: existing frontend test harness + unchanged `frontend/src/pages/Imports.tsx`.
- Produces: seven green tests. Tasks 2–7 rely on them to stay green through the split.

- [ ] **Step 1: Read Imports.tsx**

Read `frontend/src/pages/Imports.tsx` in full (787 lines). Note:
- Exact upload-form input labels + submit button text.
- Exact "success" copy after CSV upload (e.g., "N transactions importées").
- Exact strings for the duplicates panel: section header, "not a duplicate" button label, delete affordance.
- Exact file-imports list column headers + delete affordance.
- Exact backup export button text + restore file input label.
- Exact copy shown when PDF triggers needs-template vs. auto-import.
- The response shape from `apiUpload('/api/imports', ...)` (inspect the code, not the API spec — the frontend may reshape it).

The test code below uses regex placeholders — tighten each to the actual DOM before finalizing.

- [ ] **Step 2: Test file skeleton**

Create `frontend/src/pages/__tests__/Imports.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Imports } from '../Imports';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: vi.fn(),
    apiUpload: vi.fn(),
  };
});
import { api, apiUpload } from '../../api/client';
const apiMock = vi.mocked(api);
const uploadMock = vi.mocked(apiUpload);

function renderImports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Imports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
  uploadMock.mockReset();
});

const acc = (id: number, name: string) => ({
  id, name, type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
});

const fileImport = (id: number, overrides: Partial<any> = {}) => ({
  id, filename: `file-${id}.csv`, accountId: 1, format: 'csv',
  importedAt: '2026-06-15T00:00:00Z', totalLines: 10, insertedCount: 8,
  dedupSkipped: 2, statedBalance: null, statedBalanceDate: null,
  computedBalance: null, delta: null,
  ...overrides,
});

describe('Imports page (characterization)', () => {
  // Tests appear in subsequent steps.
});
```

- [ ] **Step 3: Test 1 — Renders upload form + file-imports list**

```tsx
it('renders the upload form and the file-imports list', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: [fileImport(1)] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    throw new Error(`unexpected: ${path}`);
  });

  renderImports();

  // Upload form present.
  expect(await screen.findByLabelText(/fichier|file/i)).toBeInTheDocument();
  // File-imports list contains the mocked import.
  expect(await screen.findByText('file-1.csv')).toBeInTheDocument();
});
```

- [ ] **Step 4: Test 2 — Upload a CSV**

```tsx
it('uploads a CSV file and shows the success banner', async () => {
  let uploaded = false;
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: uploaded ? [fileImport(99, { filename: 'new.csv' })] : [] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    throw new Error(`unexpected: ${path}`);
  });
  uploadMock.mockImplementation(async () => {
    uploaded = true;
    return { fileImport: fileImport(99, { filename: 'new.csv', insertedCount: 5 }) };
  });

  const user = userEvent.setup();
  renderImports();
  await screen.findByLabelText(/fichier|file/i);

  const fileInput = screen.getByLabelText(/fichier|file/i) as HTMLInputElement;
  const file = new File(['date;label;amount\n2026-06-15;A;-10'], 'new.csv', { type: 'text/csv' });
  await user.upload(fileInput, file);

  await user.selectOptions(fieldFor(/compte|account/i), '1');
  await user.click(screen.getByRole('button', { name: /importer|upload/i }));

  await waitFor(() => expect(uploadMock).toHaveBeenCalled());
  // Success banner or new row in the list.
  expect(await screen.findByText('new.csv')).toBeInTheDocument();
});
```

- [ ] **Step 5: Test 3 — PDF needs template**

```tsx
it('shows the PDF template wizard when the upload returns needs_template', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: [] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    throw new Error(`unexpected: ${path}`);
  });
  uploadMock.mockResolvedValue({
    kind: 'needs_template',
    draftId: 42,
    fingerprint: 'fp-xyz',
    pages: [{ pageIndex: 0, widthPt: 595, heightPt: 842, pngBase64: 'AAAA' }],
    textItems: [],
    suggestedZones: null,
    reason: 'low_confidence',
  });

  const user = userEvent.setup();
  renderImports();
  await screen.findByLabelText(/fichier|file/i);

  const fileInput = screen.getByLabelText(/fichier|file/i) as HTMLInputElement;
  const file = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'statement.pdf', { type: 'application/pdf' });
  await user.upload(fileInput, file);
  await user.selectOptions(fieldFor(/compte|account/i), '1');
  await user.click(screen.getByRole('button', { name: /importer|upload/i }));

  // PdfTemplateBuilder should render — assert a distinguishing string it renders.
  // Adjust the regex to match the actual PdfTemplateBuilder heading/label.
  expect(await screen.findByText(/zone|template|modèle/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Test 4 — PDF auto-imported**

```tsx
it('shows the lastImported banner when the PDF auto-imports', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: [] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    throw new Error(`unexpected: ${path}`);
  });
  uploadMock.mockResolvedValue({
    kind: 'imported',
    result: { fileImport: fileImport(50, { filename: 'auto.pdf' }), insertedCount: 5, dedupSkipped: 0 },
    skippedRows: [],
  });

  const user = userEvent.setup();
  renderImports();
  await screen.findByLabelText(/fichier|file/i);

  const fileInput = screen.getByLabelText(/fichier|file/i) as HTMLInputElement;
  const file = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'auto.pdf', { type: 'application/pdf' });
  await user.upload(fileInput, file);
  await user.selectOptions(fieldFor(/compte|account/i), '1');
  await user.click(screen.getByRole('button', { name: /importer|upload/i }));

  // Assert the lastImported success block — adjust to actual copy.
  expect(await screen.findByText(/5.*transaction|inserted.*5|auto\.pdf/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Test 5 — Duplicates panel + mark-not-duplicate**

```tsx
it('marks a duplicate transaction as not-a-duplicate via PATCH', async () => {
  const putBodies: any[] = [];
  let marked = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: [] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') {
      return {
        groups: marked ? [] : [
          {
            date: '2026-06-15', amount: '-42.30', accountId: 1,
            transactions: [
              { id: 100, rawLabel: 'CB CARREFOUR A', notDuplicate: false, ... },
              { id: 101, rawLabel: 'CB CARREFOUR B', notDuplicate: false, ... },
            ],
          },
        ],
      };
    }
    if (path === '/api/transactions/100' && init?.method === 'PATCH') {
      putBodies.push(init.json);
      marked = true;
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderImports();
  await screen.findByText(/CB CARREFOUR A/);

  // Click the "not a duplicate" affordance on the first row.
  // Adjust to actual button label.
  const buttons = screen.getAllByRole('button', { name: /pas un doublon|not a duplicate/i });
  await user.click(buttons[0]);

  await waitFor(() => expect(putBodies).toHaveLength(1));
  // Single-field patch: notDuplicate: true (or whatever the actual field name is).
  expect(Object.keys(putBodies[0])).toEqual(['notDuplicate']);
});
```

Fill in the `...` in the mock rows with all required Transaction fields when adapting. Adjust the actual PATCH endpoint (`/api/transactions/100` may be `/api/tri/mark-not-duplicate/100` or similar — read `Imports.tsx`).

- [ ] **Step 8: Test 6 — Delete a past file-import**

```tsx
it('deletes a file-import after confirmation', async () => {
  let deleted = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: deleted ? [] : [fileImport(7)] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    if (path === '/api/imports/7' && init?.method === 'DELETE') {
      deleted = true;
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderImports();
  await screen.findByText('file-7.csv');

  // Adjust label to actual delete affordance (icon-only vs. labeled button).
  await user.click(screen.getByRole('button', { name: /supprimer|delete/i }));
  // ConfirmDialog appears.
  await user.click(await screen.findByRole('button', { name: /confirmer|supprimer/i }));

  await waitFor(() => expect(screen.queryByText('file-7.csv')).not.toBeInTheDocument());
});
```

- [ ] **Step 9: Test 7 — Backup export + restore**

```tsx
it('fires the backup and restore mutations from the BackupPanel', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/imports') return { imports: [] };
    if (path === '/api/tri/duplicates' || path === '/api/duplicates') return { groups: [] };
    if (path === '/api/backup/export') return { ok: true, url: 'blob:x' };
    throw new Error(`unexpected: ${path}`);
  });
  uploadMock.mockResolvedValue({ restored: true, counts: { transactions: 5 } });

  const user = userEvent.setup();
  renderImports();
  await screen.findByLabelText(/fichier|file/i);

  // Adjust to actual button labels.
  await user.click(screen.getByRole('button', { name: /exporter|backup/i }));

  const restoreInput = screen.getByLabelText(/restaurer|restore/i) as HTMLInputElement;
  const backupFile = new File(['{}'], 'backup.json', { type: 'application/json' });
  await user.upload(restoreInput, backupFile);

  await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(expect.stringMatching(/restore/i), expect.anything(), expect.anything()));
});
```

Test 7 assertions target the actual backup/restore endpoint paths — read `Imports.tsx` for the exact URL, and adjust `expect.stringMatching(/restore/i)` accordingly.

- [ ] **Step 10: Run the suite**

```bash
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: `7 passed`. If any test fails on a label / role / API-path mismatch, adjust the query — do NOT modify `Imports.tsx`. If a test fundamentally can't pass because the feature works differently than the brief assumes, report DONE_WITH_CONCERNS with specifics.

- [ ] **Step 11: TSC**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/pages/__tests__/Imports.test.tsx
git commit -m "$(cat <<'EOF'
test(imports): characterization suite for pages/Imports.tsx

Seven end-to-end component tests locking in today's behavior via
mocked api/apiUpload clients: list render, CSV upload, PDF needs-
template, PDF auto-imported, duplicates panel mark-not-duplicate,
delete file-import, backup+restore.

These are the safety net for the pages/Imports/ split — every test
must remain green after every extraction with zero test-code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Move `Imports.tsx` to `Imports/index.tsx`

**Files:**
- Delete: `frontend/src/pages/Imports.tsx`
- Create: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the file location Tasks 3–7 extract from.

- [ ] **Step 1: Move**

```bash
mkdir -p frontend/src/pages/Imports
git mv frontend/src/pages/Imports.tsx frontend/src/pages/Imports/index.tsx
```

- [ ] **Step 2: Fix relative imports**

In the moved file, change every `from '../` to `from '../../`. Confirm:
```bash
grep -n "from '\\.\\./" frontend/src/pages/Imports/index.tsx
grep -n "from '\\./" frontend/src/pages/Imports/index.tsx
```
The second must be empty.

- [ ] **Step 3: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/pages
git commit -m "$(cat <<'EOF'
refactor(imports): move pages/Imports.tsx to pages/Imports/index.tsx

Pure relocation with adjusted relative imports. No behavior change;
characterization tests still green. Prepares for extraction of
BackupPanel, PdfTemplateWizard, DuplicatesPanel, FileImportsList,
and UploadForm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Extract `BackupPanel` (self-contained, extract first)

**Files:**
- Create: `frontend/src/pages/Imports/BackupPanel.tsx`
- Modify: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: `api` from `../../api/client`, `apiUpload` for restore.
- Produces:
  ```ts
  export function BackupPanel(): JSX.Element;
  ```
  BackupPanel is self-contained — owns its own state (`backupError`, `backupResult`, `exporting`) + mutations. No props required unless there's a shared callback (e.g., `onRestoreSuccess` to trigger a full-page refresh) — read `index.tsx` to check.

- [ ] **Step 1: Identify BackupPanel scope**

In `frontend/src/pages/Imports/index.tsx`, locate:
- The backup-related state (`backupError`, `backupResult`, `exporting`).
- The backup/restore mutation definitions and their `onSuccess`/`onError` handlers.
- The JSX section rendering the export button + restore file input + result/error banners.

Note whether any external state (e.g., invalidating `['imports']`, `['accounts']`, `['transactions']`) needs to happen on restore success. If so, that invalidation logic MUST stay in `BackupPanel` (it has access to `useQueryClient()`) — preserve verbatim.

- [ ] **Step 2: Create `BackupPanel.tsx`**

Create `frontend/src/pages/Imports/BackupPanel.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '../../api/client';
// Any other imports the backup section uses (types, format helpers, etc.).

export function BackupPanel() {
  const qc = useQueryClient();
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState</* actual type from index.tsx */ | null>(null);
  const [exporting, setExporting] = useState(false);

  // Paste the backup/restore mutations verbatim from index.tsx here.
  // Paste the JSX section verbatim.

  return (/* JSX */);
}
```

- [ ] **Step 3: Update `index.tsx`**

Delete the backup-related state, mutations, and JSX. Add:
```ts
import { BackupPanel } from './BackupPanel';
```
Render `<BackupPanel />` where the inline section used to be.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`. Test #7 (backup+restore) exercises this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/BackupPanel.tsx frontend/src/pages/Imports/index.tsx
git commit -m "$(cat <<'EOF'
refactor(imports): extract BackupPanel

Self-contained: owns its own state, mutations, and cache invalidations.
No props from parent. Characterization Test #7 still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Extract `PdfTemplateWizard` (prop-driven, tiny)

**Files:**
- Create: `frontend/src/pages/Imports/PdfTemplateWizard.tsx`
- Modify: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: `PdfTemplateBuilder` from `../../components/PdfTemplateBuilder/`; type imports for the needs-template payload.
- Produces:
  ```ts
  export function PdfTemplateWizard({
    needsTpl, lastImported, pdfError,
    accountId,
    onFinalize, onCancel,
  }: {
    needsTpl: PdfImportNeedsTemplate | null;
    lastImported: PdfImportImported | null;
    pdfError: string | null;
    accountId: number | '';
    onFinalize: (result: any) => void;  // shape per actual PdfTemplateBuilder onFinalize
    onCancel: () => void;
  }): JSX.Element | null;
  ```

Adjust to match the actual props the current inline `PdfTemplateBuilder` invocation receives.

- [ ] **Step 1: Identify PDF wizard JSX**

In `index.tsx`, locate the JSX that renders `<PdfTemplateBuilder ...>` (or an equivalent invocation). Note:
- What state drives it (`needsTpl`, `lastImported`, `pdfError`, `pdfPending`).
- What callbacks it passes (`onFinalize`, `onCancel`).
- Whether it renders anything else besides `PdfTemplateBuilder` (e.g., a success banner for `lastImported`).

- [ ] **Step 2: Create `PdfTemplateWizard.tsx`**

Create the file. Body = the JSX moved verbatim, receiving the state via props instead of closure. Returns `null` when neither `needsTpl` nor `lastImported` is set.

- [ ] **Step 3: Update `index.tsx`**

Replace the inline PDF-wizard JSX with:
```tsx
<PdfTemplateWizard
  needsTpl={needsTpl}
  lastImported={lastImported}
  pdfError={pdfError}
  accountId={accountId}
  onFinalize={(result) => { setNeedsTpl(null); setLastImported(result); }}
  onCancel={() => setNeedsTpl(null)}
/>
```
Adjust `onFinalize`/`onCancel` to match the actual flow. Add `import { PdfTemplateWizard } from './PdfTemplateWizard';`.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`. Tests #3 (needs-template) and #4 (auto-imported) exercise this.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/PdfTemplateWizard.tsx frontend/src/pages/Imports/index.tsx
git commit -m "$(cat <<'EOF'
refactor(imports): extract PdfTemplateWizard

Prop-driven wrapper around components/PdfTemplateBuilder. Owns no
state; consumes needsTpl/lastImported/pdfError from the parent.
Characterization Tests #3 and #4 still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Extract `DuplicatesPanel`

**Files:**
- Create: `frontend/src/pages/Imports/DuplicatesPanel.tsx`
- Modify: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: `api` from `../../api/client`, `ConfirmDialog` from `../../components/ConfirmDialog`; type imports.
- Produces:
  ```ts
  export function DuplicatesPanel(): JSX.Element;
  ```
  Self-contained: owns `dupsQ` query, `markNotDuplicateMut`, `deleteTxMut`, `confirmDeleteTxId`, `dupDeleteError` state. No props required.

- [ ] **Step 1: Identify Duplicates section**

In `index.tsx`, locate:
- The `dupsQ` `useQuery`.
- The state `confirmDeleteTxId`, `dupDeleteError`.
- The mutations `markNotDuplicateMut`, `deleteTxMut`.
- The JSX rendering the section (probably a titled block with grouped rows + per-row "not a duplicate" and delete buttons).

- [ ] **Step 2: Create `DuplicatesPanel.tsx`**

Move all of the above verbatim into `DuplicatesPanel.tsx`. Include the necessary imports (React hooks, TanStack Query, `api`, `ConfirmDialog`, types).

- [ ] **Step 3: Update `index.tsx`**

Delete the duplicates-related state, query, mutations, and JSX. Add:
```ts
import { DuplicatesPanel } from './DuplicatesPanel';
```
Render `<DuplicatesPanel />`.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`. Test #5 (mark-not-duplicate) exercises this.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/DuplicatesPanel.tsx frontend/src/pages/Imports/index.tsx
git commit -m "$(cat <<'EOF'
refactor(imports): extract DuplicatesPanel

Self-contained: owns its own dupsQ query and two mutations.
Characterization Test #5 still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Extract `FileImportsList`

**Files:**
- Create: `frontend/src/pages/Imports/FileImportsList.tsx`
- Modify: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: `FileImport`, `Account` types from `../../api/types`; `api` for stated-balance edit.
- Produces:
  ```ts
  export function FileImportsList({
    imports, accounts, onRequestDelete,
  }: {
    imports: FileImport[];
    accounts: Account[];
    onRequestDelete: (fileImport: FileImport) => void;
  }): JSX.Element;
  ```
  Owns the stated-balance inline-edit state + mutation. Delete flows to parent (which owns the confirm dialog).

- [ ] **Step 1: Identify list JSX**

In `index.tsx`, locate the file-imports list rendering. Note:
- Row rendering (columns: filename / date / inserted / dedup-skipped / stated balance / delete).
- Stated-balance inline-edit state + mutation.
- Delete button — probably calls `setPendingDeleteImport` on the parent.

- [ ] **Step 2: Create `FileImportsList.tsx`**

Move the list + stated-balance edit into the new file. Delete affordance calls `onRequestDelete(fileImport)` (parent-provided callback).

- [ ] **Step 3: Update `index.tsx`**

Replace the inline JSX with `<FileImportsList imports={importsQ.data?.imports ?? []} accounts={accountsQ.data?.accounts ?? []} onRequestDelete={(fi) => setPendingDeleteImport(fi)} />`. The ConfirmDialog + `deleteImport` mutation stay in `index.tsx`.

Add `import { FileImportsList } from './FileImportsList';`.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`. Test #6 (delete file-import) exercises this.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/FileImportsList.tsx frontend/src/pages/Imports/index.tsx
git commit -m "$(cat <<'EOF'
refactor(imports): extract FileImportsList

Owns stated-balance inline-edit state + mutation. Delete flows to
parent via onRequestDelete callback (parent owns the ConfirmDialog).
Characterization Test #6 still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Extract `UploadForm` (last, most complex)

**Files:**
- Create: `frontend/src/pages/Imports/UploadForm.tsx`
- Modify: `frontend/src/pages/Imports/index.tsx`

**Interfaces:**
- Consumes: `api`, `apiUpload`; type imports.
- Produces:
  ```ts
  export function UploadForm({
    accounts,
    onPdfNeedsTemplate, onPdfImported, onOfxCsvSuccess,
  }: {
    accounts: Account[];
    onPdfNeedsTemplate: (payload: PdfImportNeedsTemplate) => void;
    onPdfImported: (payload: PdfImportImported) => void;
    onOfxCsvSuccess: (result: any) => void;
  }): JSX.Element;
  ```
  UploadForm owns `file` / `accountId` / `error` / `lastResult` / `pdfPending` state and the upload mutation. On success, branches on response `kind` (for PDF) and calls the appropriate parent callback. For OFX/CSV, calls `onOfxCsvSuccess`.

- [ ] **Step 1: Identify upload flow**

In `index.tsx`, locate:
- Upload form JSX (file input + account select + submit).
- `file`, `accountId`, `error`, `lastResult`, `pdfPending` state.
- The `upload.mutate` mutation + its response handling (branching on file extension + PDF response `kind`).

- [ ] **Step 2: Create `UploadForm.tsx`**

Move the upload state, mutation, and JSX into the new file. On mutation success:
```ts
onSuccess: (data) => {
  if (data.kind === 'needs_template') {
    onPdfNeedsTemplate(data);
  } else if (data.kind === 'imported') {
    onPdfImported(data);
  } else {
    onOfxCsvSuccess(data);
  }
  qc.invalidateQueries({ queryKey: ['imports'] });
  // Preserve every other invalidation from the pre-refactor code.
},
```

Add `useQueryClient()` inside UploadForm so it can invalidate `['imports']` on success.

- [ ] **Step 3: Update `index.tsx`**

Replace the inline upload JSX with:
```tsx
<UploadForm
  accounts={accountsQ.data?.accounts ?? []}
  onPdfNeedsTemplate={(p) => { setNeedsTpl(p); setLastImported(null); setPdfError(null); }}
  onPdfImported={(p) => { setLastImported(p); setNeedsTpl(null); setPdfError(null); }}
  onOfxCsvSuccess={(r) => { setLastResult(r); }}
/>
```
Adjust setter names to actual state in `index.tsx`. Add `import { UploadForm } from './UploadForm';`. Remove now-unused parent state (`file`, `accountId`, `error`, `lastResult`, `pdfPending`).

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Imports.test.tsx
```
Expected: 0 errors, `7 passed`. Tests #2 (CSV), #3 (PDF needs-template), #4 (PDF auto-imported) all exercise this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/UploadForm.tsx frontend/src/pages/Imports/index.tsx
git commit -m "$(cat <<'EOF'
refactor(imports): extract UploadForm

UploadForm owns file/account/upload-pending state and the upload
mutation. On success it branches on response kind: PDF needs-template
→ onPdfNeedsTemplate; PDF imported → onPdfImported; OFX/CSV →
onOfxCsvSuccess. Parent still owns the pending-import handoff state
consumed by PdfTemplateWizard.

Removed now-orphaned parent state. Characterization Tests #2/#3/#4
still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Unit tests: `UploadForm` + `PdfTemplateWizard`

**Files:**
- Create: `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx`
- Create: `frontend/src/pages/Imports/__tests__/PdfTemplateWizard.test.tsx`

**Interfaces:**
- Consumes: extracted `UploadForm` (Task 7), `PdfTemplateWizard` (Task 4).

- [ ] **Step 1: Write `UploadForm.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadForm } from '../UploadForm';
import type { Account } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn(), apiUpload: vi.fn() };
});
import { api, apiUpload } from '../../../api/client';
const apiMock = vi.mocked(api);
const uploadMock = vi.mocked(apiUpload);

const accs: Account[] = [
  { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
    openingBalance: '0', openingDate: '2025-01-01' },
];

function renderForm(overrides: Partial<any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    accounts: accs,
    onPdfNeedsTemplate: vi.fn(),
    onPdfImported: vi.fn(),
    onOfxCsvSuccess: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <QueryClientProvider client={client}>
        <UploadForm {...props} />
      </QueryClientProvider>,
    ),
    props,
  };
}

function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => { apiMock.mockReset(); uploadMock.mockReset(); });

describe('UploadForm', () => {
  it('renders file input + account select + submit button', () => {
    renderForm();
    expect(screen.getByLabelText(/fichier|file/i)).toBeInTheDocument();
    // Adjust label to actual.
    expect(screen.getByRole('button', { name: /importer|upload/i })).toBeInTheDocument();
  });

  it('CSV submit fires apiUpload and onOfxCsvSuccess', async () => {
    uploadMock.mockResolvedValue({ fileImport: { id: 1 }, insertedCount: 5, dedupSkipped: 0 });
    const user = userEvent.setup();
    const { props } = renderForm();
    const input = screen.getByLabelText(/fichier|file/i) as HTMLInputElement;
    await user.upload(input, new File(['x'], 'a.csv', { type: 'text/csv' }));
    await user.selectOptions(fieldFor(/compte|account/i), '1');
    await user.click(screen.getByRole('button', { name: /importer|upload/i }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(props.onOfxCsvSuccess).toHaveBeenCalled();
  });

  it('PDF needs_template response fires onPdfNeedsTemplate', async () => {
    uploadMock.mockResolvedValue({ kind: 'needs_template', draftId: 42, fingerprint: 'x',
      pages: [], textItems: [], suggestedZones: null, reason: 'low_confidence' });
    const user = userEvent.setup();
    const { props } = renderForm();
    const input = screen.getByLabelText(/fichier|file/i) as HTMLInputElement;
    await user.upload(input, new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' }));
    await user.selectOptions(fieldFor(/compte|account/i), '1');
    await user.click(screen.getByRole('button', { name: /importer|upload/i }));
    await waitFor(() => expect(props.onPdfNeedsTemplate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'needs_template' })));
  });

  it('submit is disabled when file or account is missing', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /importer|upload/i })).toBeDisabled();
  });
});
```

Adjust selectors + response shapes to actual DOM after reading `UploadForm.tsx`.

- [ ] **Step 2: Write `PdfTemplateWizard.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfTemplateWizard } from '../PdfTemplateWizard';

describe('PdfTemplateWizard', () => {
  it('renders PdfTemplateBuilder when needsTpl is set', () => {
    render(
      <PdfTemplateWizard
        needsTpl={{ kind: 'needs_template', draftId: 42, fingerprint: 'x',
          pages: [{ pageIndex: 0, widthPt: 595, heightPt: 842, pngBase64: 'AAAA' }],
          textItems: [], suggestedZones: null, reason: 'low_confidence' }}
        lastImported={null}
        pdfError={null}
        accountId={1}
        onFinalize={() => {}}
        onCancel={() => {}}
      />,
    );
    // Adjust regex to a string PdfTemplateBuilder actually renders.
    expect(screen.getByText(/zone|template|modèle/i)).toBeInTheDocument();
  });

  it('renders lastImported banner when lastImported is set', () => {
    render(
      <PdfTemplateWizard
        needsTpl={null}
        lastImported={{ kind: 'imported',
          result: { fileImport: { id: 1, filename: 'x.pdf' }, insertedCount: 3, dedupSkipped: 0 },
          skippedRows: [] }}
        pdfError={null}
        accountId={1}
        onFinalize={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/3.*transaction|inserted.*3|x\.pdf/i)).toBeInTheDocument();
  });

  it('renders nothing when both needsTpl and lastImported are null', () => {
    const { container } = render(
      <PdfTemplateWizard
        needsTpl={null} lastImported={null} pdfError={null}
        accountId={1} onFinalize={() => {}} onCancel={() => {}}
      />,
    );
    // If the component returns null, container has no children.
    // If it renders an empty wrapper, adjust the assertion.
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 3: Run the two test files**

```bash
cd frontend && npx vitest run src/pages/Imports/__tests__/UploadForm.test.tsx src/pages/Imports/__tests__/PdfTemplateWizard.test.tsx
```
Expected: all pass.

- [ ] **Step 4: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Imports/__tests__/UploadForm.test.tsx frontend/src/pages/Imports/__tests__/PdfTemplateWizard.test.tsx
git commit -m "$(cat <<'EOF'
test(imports): unit tests for UploadForm and PdfTemplateWizard

UploadForm: 4 tests (render, CSV submit → onOfxCsvSuccess,
PDF needs-template → onPdfNeedsTemplate, submit-disabled guard).
PdfTemplateWizard: 3 tests (renders PdfTemplateBuilder when needsTpl,
renders lastImported banner, renders nothing when both null).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Unit tests: `DuplicatesPanel` + `FileImportsList` + `BackupPanel`

**Files:**
- Create: `frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx`
- Create: `frontend/src/pages/Imports/__tests__/FileImportsList.test.tsx`
- Create: `frontend/src/pages/Imports/__tests__/BackupPanel.test.tsx`

- [ ] **Step 1: Write `DuplicatesPanel.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DuplicatesPanel } from '../DuplicatesPanel';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DuplicatesPanel /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); });

describe('DuplicatesPanel', () => {
  it('renders empty state (or nothing) when there are no duplicate groups', async () => {
    apiMock.mockResolvedValue({ groups: [] });
    renderPanel();
    // If the panel renders a hidden section on empty, assert it's absent.
    // If it renders an empty-state string, assert that string.
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
  });

  it('renders one group per cluster', async () => {
    apiMock.mockResolvedValue({
      groups: [{ date: '2026-06-15', amount: '-42.30', accountId: 1,
        transactions: [
          { id: 100, rawLabel: 'A', notDuplicate: false },
          { id: 101, rawLabel: 'B', notDuplicate: false },
        ] }],
    });
    renderPanel();
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(await screen.findByText('B')).toBeInTheDocument();
  });

  it('mark-not-duplicate fires PATCH with single-field body', async () => {
    const putBodies: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path.startsWith('/api/duplicates') || path.startsWith('/api/tri/duplicates')) {
        return { groups: [{ date: '2026-06-15', amount: '-1', accountId: 1,
          transactions: [{ id: 100, rawLabel: 'X', notDuplicate: false }] }] };
      }
      if (init?.method === 'PATCH') { putBodies.push(init.json); return { ok: true }; }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('X');
    await user.click(screen.getByRole('button', { name: /pas un doublon|not a duplicate/i }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(Object.keys(putBodies[0])).toEqual(['notDuplicate']);
  });
});
```

- [ ] **Step 2: Write `FileImportsList.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileImportsList } from '../FileImportsList';
import type { FileImport, Account } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const acc: Account = { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01' };

const rows: FileImport[] = [
  { id: 7, filename: 'a.csv', accountId: 1, format: 'csv',
    importedAt: '2026-06-15T00:00:00Z', totalLines: 10, insertedCount: 8,
    dedupSkipped: 2, statedBalance: null, statedBalanceDate: null,
    computedBalance: null, delta: null },
];

function renderList(props: Partial<any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <FileImportsList imports={rows} accounts={[acc]} onRequestDelete={vi.fn()} {...props} />
  </QueryClientProvider>);
}

describe('FileImportsList', () => {
  it('renders each import with filename and counts', () => {
    renderList();
    expect(screen.getByText('a.csv')).toBeInTheDocument();
    expect(screen.getByText(/8/)).toBeInTheDocument();
  });

  it('delete button fires onRequestDelete(fileImport)', async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    renderList({ onRequestDelete });
    await user.click(screen.getByRole('button', { name: /supprimer|delete/i }));
    expect(onRequestDelete).toHaveBeenCalledWith(rows[0]);
  });
});
```

Add a third assertion for the stated-balance inline edit if the affordance is reasonably testable — if it requires opening a modal or complex interaction, skip and note in the report.

- [ ] **Step 3: Write `BackupPanel.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupPanel } from '../BackupPanel';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn(), apiUpload: vi.fn() };
});
import { api, apiUpload } from '../../../api/client';
const apiMock = vi.mocked(api);
const uploadMock = vi.mocked(apiUpload);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BackupPanel /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); uploadMock.mockReset(); });

describe('BackupPanel', () => {
  it('export button fires the backup mutation', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPanel();
    // Adjust button label.
    await user.click(screen.getByRole('button', { name: /exporter|backup/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
  });

  it('restore file input fires the restore mutation', async () => {
    uploadMock.mockResolvedValue({ restored: true });
    const user = userEvent.setup();
    renderPanel();
    // Adjust label.
    const restoreInput = screen.getByLabelText(/restaurer|restore/i) as HTMLInputElement;
    await user.upload(restoreInput, new File(['{}'], 'b.json', { type: 'application/json' }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
  });
});
```

- [ ] **Step 4: Run the three test files**

```bash
cd frontend && npx vitest run src/pages/Imports/__tests__/DuplicatesPanel.test.tsx src/pages/Imports/__tests__/FileImportsList.test.tsx src/pages/Imports/__tests__/BackupPanel.test.tsx
```
Expected: all pass.

- [ ] **Step 5: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx frontend/src/pages/Imports/__tests__/FileImportsList.test.tsx frontend/src/pages/Imports/__tests__/BackupPanel.test.tsx
git commit -m "$(cat <<'EOF'
test(imports): unit tests for DuplicatesPanel, FileImportsList, BackupPanel

DuplicatesPanel: empty state, one group per cluster, mark-not-duplicate
PATCH single-field body.
FileImportsList: rows render, delete callback fires with fileImport.
BackupPanel: export button, restore file input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — STATUS.md refresh + push

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Update `Recently landed`**

Add at top:
```markdown
- 2026-07-02 — Imports.tsx split into pages/Imports/ (6 focused files)
  with characterization + unit tests. Fourth interleave iteration.
```

- [ ] **Step 2: Update the refactor table**

`Imports.tsx | ✅ (7) | ✅ | ✅ (~18)` — 7 characterization + ~18 unit tests (4 UploadForm + 3 PdfTemplateWizard + 3 DuplicatesPanel + 2 FileImportsList + 2 BackupPanel = ~14; adjust to actual count when known).

- [ ] **Step 3: Update `_Last updated:_`**

`_Last updated: 2026-07-02_`.

- [ ] **Step 4: TSC + full suite**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run
```
Expected: 0 errors, full suite green.

- [ ] **Step 5: Commit + push**

```bash
git add STATUS.md
git commit -m "$(cat <<'EOF'
docs(status): mark Imports.tsx refactor+tests iteration complete

Fourth interleave iteration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Watch CI**

```bash
gh run watch $(gh run list --workflow ci.yml --limit 1 --repo Gekkotron/Athena-Accounting --json databaseId --jq '.[0].databaseId') --repo Gekkotron/Athena-Accounting --exit-status
```
Expected: both jobs green.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task. Characterization → Task 1. Relocation → Task 2. Split → Tasks 3–7 (leaf-first: BackupPanel → PdfTemplateWizard → DuplicatesPanel → FileImportsList → UploadForm). Unit tests → Tasks 8–9. STATUS.md → Task 10.
- **Type consistency:** `UploadForm`'s callback interface (`onPdfNeedsTemplate` / `onPdfImported` / `onOfxCsvSuccess`) is consumed by `index.tsx` (Task 7) and tested in Task 8. `PdfTemplateWizard`'s props (`needsTpl` / `lastImported` / `pdfError` / `accountId` / `onFinalize` / `onCancel`) match between Task 4's extraction and Task 8's tests. `FileImportsList`'s `onRequestDelete(fileImport)` matches between Task 6 and Task 9.
- **Placeholder scan:** no TBDs. The inline `// adjust to actual` comments are legitimate "read reality first" markers, not incomplete work — every step has a clear invariant.
- **Guardrails:** pending-import handoff stays in `index.tsx` (spec + Task 4 + Task 7 all reference this); single-field PATCH assertions are in Test #5 and its unit-test counterpart in Task 9.
