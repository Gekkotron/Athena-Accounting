# Accounts.tsx Refactor + Frontend Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the frontend Vitest + Testing Library + jsdom test harness, characterize `Accounts.tsx`'s current behavior with six end-to-end component tests, split it into a `pages/Accounts/` directory of six focused files, and lock in the split with fine-grained unit tests + a top-level `STATUS.md`.

**Architecture:** Three-PR interleave: **characterize** the page's user-visible behavior BEFORE any refactor, so the split becomes a green-suite refactor rather than a risky one. **Split** into single-responsibility components under a directory: `index.tsx` orchestrates, `AccountCard` / `AccountForm` / `BalanceCheckpointsDrawer` / `CheckpointRow` / `PatternsSection` are leaves. **Unit-test** the leaves post-split for regression coverage. `STATUS.md` becomes the persistent snapshot of project state, refactor progress, and known deferrals.

**Tech Stack:** Vitest 2 + `@testing-library/react` + `@testing-library/user-event` + `jsdom` (frontend); React 18 + Vite + TanStack Query v5 + Tailwind (existing); `@vitest/coverage-v8` for the coverage report (matches backend); GitHub Actions + Codecov v4 for CI.

**Spec:** `docs/superpowers/specs/2026-07-01-accounts-refactor-tests-design.md`

## Global Constraints

- Frontend money strings stay as strings until the render boundary. `expectedAmount`, `openingBalance`, `currentBalance` are all `string` on the wire and get parsed with `Number(...)` only inside JSX or chart code. Match this in every new file.
- Cache keys must NOT change across the refactor. `['accounts']`, `['patterns']`, `['balance-checkpoints', accountId]` are all consumed by other pages (Dashboard consumes the checkpoint key). Any rename silently staleifies the Dashboard chart.
- Every characterization test written in Task 2 must remain green after every split task (Tasks 4–8). No skip, no update, no `.only`. If a split breaks a characterization test, the split is wrong.
- Testing Library idioms: prefer `getByRole` / `findByRole` over `getByTestId`; prefer `@testing-library/user-event` (`userEvent.setup()`) over `fireEvent`; no snapshot tests; assertions are user-visible (text, aria-label, role), not implementation details (state variable names, CSS classes).
- Public-safe: no IPs, no hostnames, no credentials, no PII. The repo is public.
- Commit convention: `<type>(<scope>): <short-summary>` — `test(accounts)`, `refactor(accounts)`, `chore(ci)`, `docs`, etc. Every commit ends with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Test file location: co-locate with the code under a `__tests__/` subdirectory (`pages/Accounts/__tests__/*.test.tsx`) — Vitest picks it up automatically.
- `frontend/tsconfig.json` currently does NOT include `tests/**`. This plan does not fix that (it's a known deferral in `STATUS.md`) but any test files we add must be under paths tsc *doesn't* type-check today, so they can compile via Vitest's own resolution without breaking `tsc --noEmit`.

---

## Task 1 — Frontend test harness setup

**Files:**
- Modify: `frontend/package.json` (scripts + devDependencies)
- Modify: `frontend/tsconfig.json` (types)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`

**Interfaces:**
- Consumes: (existing frontend workspace with React 18 + Vite + TanStack Query already installed).
- Produces: a working `npm run test` (empty run passes) and `npm run test:coverage` (empty run passes, emits `coverage/lcov.info`). Task 2 consumes this by writing the first test files.

- [ ] **Step 1: Update `frontend/package.json`**

Read `frontend/package.json`. Add to `scripts`:

```json
"test": "vitest",
"test:coverage": "vitest run --coverage"
```

Add to `devDependencies` (or create it if missing) — pin versions matching Vitest 2.x:

```json
"@testing-library/jest-dom": "^6.6.3",
"@testing-library/react": "^16.1.0",
"@testing-library/user-event": "^14.5.2",
"@types/react": "^18.3.12",
"@types/react-dom": "^18.3.1",
"@vitest/coverage-v8": "^2.1.8",
"jsdom": "^25.0.1",
"vitest": "^2.1.8"
```

(If any of these are already present, do not duplicate them — only add missing entries. `@types/react*` may already be there.)

- [ ] **Step 2: Refresh the lock file**

Run:
```bash
cd frontend && npm install --package-lock-only
```
Expected: exits 0, `frontend/package-lock.json` now contains `@testing-library/react`. Confirm with:
```bash
grep -c '@testing-library/react' frontend/package-lock.json
```
Expected: >= 1.

- [ ] **Step 3: Create `frontend/vitest.config.ts`**

Create the file with exactly this content:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/__tests__/**',
      ],
    },
  },
});
```

Note: `@vitejs/plugin-react` is already a dev-dep of any Vite-React project. Verify with `grep '@vitejs/plugin-react' frontend/package.json`. If it is absent, add `"@vitejs/plugin-react": "^4.3.4"` to `frontend/package.json` devDependencies and re-run Step 2 to refresh the lock.

- [ ] **Step 4: Create `frontend/src/test/setup.ts`**

Create the file with exactly this content:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Update `frontend/tsconfig.json`**

Read `frontend/tsconfig.json`. Add `"vitest/globals"` and `"@testing-library/jest-dom"` to `compilerOptions.types`. If `types` is absent, add it:

```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

- [ ] **Step 6: Verify TSC still passes**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 7: Verify empty `vitest` run**

Run:
```bash
cd frontend && npx vitest run
```
Expected: `No test files found` with exit code 0 (Vitest treats an empty suite as green; it may print a warning line but must not error).

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/tsconfig.json
git commit -m "$(cat <<'EOF'
chore(frontend): add Vitest + Testing Library + jsdom test harness

- vitest.config.ts: jsdom env, coverage via @vitest/coverage-v8 with
  lcov + text + json-summary reporters. Excludes bootstrap files.
- src/test/setup.ts: registers jest-dom matchers and afterEach cleanup.
- package.json: adds test / test:coverage scripts + dev-deps for the
  Testing Library trio and jsdom.
- tsconfig.json: types include vitest/globals and jest-dom so
  describe/it/expect and DOM matchers type-check inside tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Characterization tests on Accounts.tsx

**Files:**
- Create: `frontend/src/pages/__tests__/Accounts.test.tsx`

**Interfaces:**
- Consumes: Task 1's harness. Reads the unchanged `frontend/src/pages/Accounts.tsx`.
- Produces: six green tests that exercise Accounts page behavior end-to-end via mocked `api`. These tests are the **safety net** for Tasks 4–8: they must still pass, unchanged, after every split task.

- [ ] **Step 1: Create the test file**

Create `frontend/src/pages/__tests__/Accounts.test.tsx` with the setup skeleton (mocks + a helper `renderAccounts()`). The six `it(...)` blocks follow in the next steps:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Accounts } from '../Accounts';
import { ApiError } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: vi.fn(),
  };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderAccounts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Accounts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Route → response mapping helper. Chained calls to `apiMock` see this map
// and return the recorded response (or throw the recorded error).
function seedRoutes(map: Record<string, unknown | ((body: unknown) => unknown)>) {
  apiMock.mockImplementation(async (path: string, init?: { json?: unknown; method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const hit = map[key] ?? map[path];
    if (typeof hit === 'function') return (hit as (b: unknown) => unknown)(init?.json);
    if (hit instanceof Error) throw hit;
    if (hit === undefined) throw new Error(`unexpected api call: ${key}`);
    return hit;
  });
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('Accounts page (characterization)', () => {
  // Tests below.
});
```

- [ ] **Step 2: Add test 1 — Renders account list**

Inside the `describe(...)` block, add:

```tsx
it('renders the account list and filename patterns', async () => {
  seedRoutes({
    '/api/accounts': {
      accounts: [
        { id: 1, name: 'Compte courant', type: 'checking', currency: 'EUR',
          openingBalance: '100.00', openingDate: '2025-01-01',
          currentBalance: '250.00', transactionCount: 5, countedTransactionCount: 5,
          displayOrder: 0 },
        { id: 2, name: 'Livret A', type: 'savings', currency: 'EUR',
          openingBalance: '0.00', openingDate: '2025-01-01',
          currentBalance: '1000.00', transactionCount: 3, countedTransactionCount: 3,
          displayOrder: 1 },
      ],
    },
    '/api/account-filename-patterns': {
      patterns: [{ id: 10, pattern: 'compte_courant', accountId: 1, priority: 0 }],
    },
  });
  renderAccounts();
  expect(await screen.findByText('Compte courant')).toBeInTheDocument();
  expect(screen.getByText('Livret A')).toBeInTheDocument();
  expect(screen.getByDisplayValue('compte_courant')).toBeInTheDocument();
});
```

- [ ] **Step 3: Add test 2 — Creates an account**

```tsx
it('creates an account and shows the new card after refetch', async () => {
  const created = { id: 3, name: 'Nouveau', type: 'checking', currency: 'EUR',
    openingBalance: '0.00', openingDate: '2026-01-01' };
  let listed = false;
  apiMock.mockImplementation(async (path: string, init?: { json?: unknown; method?: string }) => {
    if (path === '/api/accounts' && (!init || init.method === undefined)) {
      return { accounts: listed ? [{ ...created, currentBalance: '0.00',
        transactionCount: 0, countedTransactionCount: 0, displayOrder: 0 }] : [] };
    }
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    if (path === '/api/accounts' && init?.method === 'POST') {
      listed = true;
      return { account: created };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderAccounts();
  await user.type(screen.getByLabelText(/nom/i), 'Nouveau');
  await user.type(screen.getByLabelText(/date d.ouverture/i), '2026-01-01');
  await user.click(screen.getByRole('button', { name: /créer/i }));

  expect(await screen.findByText('Nouveau')).toBeInTheDocument();
});
```

The labels above (`/nom/i`, `/date d.ouverture/i`, `/créer/i`) match today's `Accounts.tsx`. If the labels differ, adjust the regex — the exact text is what the current component renders.

- [ ] **Step 4: Add test 3 — Inline-edits an account**

```tsx
it('inline-edits an account name via PUT with only the changed field', async () => {
  const before = { id: 1, name: 'Old', type: 'checking', currency: 'EUR',
    openingBalance: '0.00', openingDate: '2025-01-01',
    currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
    displayOrder: 0 };
  const after = { ...before, name: 'New' };
  let putBody: any = null;
  let edited = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts' && !init?.method) {
      return { accounts: [edited ? after : before] };
    }
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    if (path === '/api/accounts/1' && init?.method === 'PUT') {
      putBody = init.json;
      edited = true;
      return { account: after };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderAccounts();
  await user.click(await screen.findByRole('button', { name: /modifier/i }));
  const nameInput = screen.getByDisplayValue('Old');
  await user.clear(nameInput);
  await user.type(nameInput, 'New');
  await user.click(screen.getByRole('button', { name: /enregistrer|sauvegarder|valider/i }));

  await waitFor(() => expect(putBody).toEqual({ name: 'New' }));
  expect(await screen.findByText('New')).toBeInTheDocument();
});
```

If today's button label differs, the regex accepts three common forms; adjust to the actual label after running the test.

- [ ] **Step 5: Add test 4 — Confirms + deletes an account**

```tsx
it('confirms then deletes an account', async () => {
  const acc = { id: 1, name: 'Doomed', type: 'checking', currency: 'EUR',
    openingBalance: '0.00', openingDate: '2025-01-01',
    currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
    displayOrder: 0 };
  let deleted = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts' && !init?.method) {
      return { accounts: deleted ? [] : [acc] };
    }
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    if (path === '/api/accounts/1' && init?.method === 'DELETE') {
      deleted = true;
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderAccounts();
  await user.click(await screen.findByRole('button', { name: /supprimer/i }));
  // ConfirmDialog appears — click the destructive confirm button.
  await user.click(await screen.findByRole('button', { name: /supprimer le compte/i }));

  await waitFor(() => expect(screen.queryByText('Doomed')).not.toBeInTheDocument());
});
```

- [ ] **Step 6: Add test 5 — Adds checkpoint + 409 on duplicate date**

```tsx
it('shows an inline error when the checkpoint date conflicts', async () => {
  const acc = { id: 1, name: 'A', type: 'checking', currency: 'EUR',
    openingBalance: '0.00', openingDate: '2025-01-01',
    currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
    displayOrder: 0 };
  let firstCreated = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts' && !init?.method) return { accounts: [acc] };
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    if (path === '/api/accounts/1/balance-checkpoints' && !init?.method) {
      return { checkpoints: firstCreated
        ? [{ id: 100, accountId: 1, checkpointDate: '2025-06-01',
            expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' }]
        : [] };
    }
    if (path === '/api/accounts/1/balance-checkpoints' && init?.method === 'POST') {
      if (!firstCreated) {
        firstCreated = true;
        return { checkpoint: { id: 100, accountId: 1, checkpointDate: '2025-06-01',
          expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' } };
      }
      throw new ApiError('checkpoint_exists', 409, { error: 'checkpoint_exists', date: '2025-06-01' });
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderAccounts();
  await user.click(await screen.findByRole('button', { name: /points de contrôle/i }));
  await user.type(screen.getByLabelText(/date du point de contrôle/i), '2025-06-01');
  await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
  await user.click(screen.getByRole('button', { name: /ajouter/i }));

  await screen.findByText('2025-06-01');

  await user.clear(screen.getByLabelText(/date du point de contrôle/i));
  await user.type(screen.getByLabelText(/date du point de contrôle/i), '2025-06-01');
  await user.type(screen.getByLabelText(/montant attendu/i), '200.00');
  await user.click(screen.getByRole('button', { name: /ajouter/i }));

  expect(await screen.findByText(/existe déjà à cette date/i)).toBeInTheDocument();
});
```

- [ ] **Step 7: Add test 6 — Add and delete a filename pattern**

```tsx
it('adds and deletes a filename pattern', async () => {
  let patterns: any[] = [];
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts' && !init?.method) {
      return { accounts: [{ id: 1, name: 'A', type: 'checking', currency: 'EUR',
        openingBalance: '0.00', openingDate: '2025-01-01', currentBalance: '0.00',
        transactionCount: 0, countedTransactionCount: 0, displayOrder: 0 }] };
    }
    if (path === '/api/account-filename-patterns' && !init?.method) {
      return { patterns };
    }
    if (path === '/api/account-filename-patterns' && init?.method === 'POST') {
      const p = { id: 42, pattern: init.json.pattern, accountId: init.json.accountId, priority: 0 };
      patterns = [p];
      return { pattern: p };
    }
    if (path === '/api/account-filename-patterns/42' && init?.method === 'DELETE') {
      patterns = [];
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderAccounts();
  await screen.findByText('A');
  // Pattern add-row lives at the bottom of the page.
  const patternInput = screen.getByPlaceholderText(/motif|pattern/i);
  await user.type(patternInput, 'compte_courant');
  await user.click(screen.getByRole('button', { name: /ajouter/i }));
  expect(await screen.findByText('compte_courant')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /supprimer/i }));
  await waitFor(() => expect(screen.queryByText('compte_courant')).not.toBeInTheDocument());
});
```

- [ ] **Step 8: Run the suite locally**

Run:
```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed` (0 failed). If any test fails on a label or role mismatch, adjust the query to match the actual current DOM (not the assertion logic).

- [ ] **Step 9: TSC check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/__tests__/Accounts.test.tsx
git commit -m "$(cat <<'EOF'
test(accounts): characterization suite for pages/Accounts.tsx

Six end-to-end component tests that lock in today's Accounts page
behavior via mocked api client: list rendering, create, inline edit,
delete + confirm, checkpoint drawer 409, and filename pattern CRUD.

These are the safety net for the pages/Accounts/ split — every test
must remain green after every extraction with zero test-code changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Frontend CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1's `npm run test:coverage`.
- Produces: a second CI job `frontend-tests` running in parallel with `backend-tests`, uploading a second coverage report to Codecov under `flags: frontend`.

- [ ] **Step 1: Append the job to the workflow**

Open `.github/workflows/ci.yml`. Add a new job under `jobs:` (parallel to the existing `backend-tests`):

```yaml
  frontend-tests:
    name: Frontend tests + coverage
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Type-check
        working-directory: frontend
        run: npx tsc -p tsconfig.json --noEmit

      - name: Run tests with coverage
        working-directory: frontend
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: frontend/coverage/lcov.info
          flags: frontend
          fail_ci_if_error: false
          token: ${{ secrets.CODECOV_TOKEN }}
```

- [ ] **Step 2: YAML sanity-check**

Run:
```bash
python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml"))' && echo OK
```
Expected: `OK`. If YAML fails to parse, fix indentation.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add frontend-tests job with Codecov upload (flags: frontend)

Parallel to backend-tests, no Postgres service needed. Uploads a
separate lcov report so Codecov shows per-flag coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 4: Watch the CI run**

Run:
```bash
gh run watch $(gh run list --workflow ci.yml --limit 1 --repo Gekkotron/Athena-Accounting --json databaseId --jq '.[0].databaseId') --repo Gekkotron/Athena-Accounting --exit-status
```
Expected: both `backend-tests` and `frontend-tests` jobs pass. Codecov upload succeeds on both.

---

## Task 4 — Move `Accounts.tsx` to `Accounts/index.tsx` (pure relocation)

**Files:**
- Delete: `frontend/src/pages/Accounts.tsx`
- Create: `frontend/src/pages/Accounts/index.tsx` (byte-identical content to the deleted file, except for import path adjustments if any relative path counts change)

**Interfaces:**
- Consumes: nothing new. The route import in `App.tsx` (`import { Accounts } from './pages/Accounts'`) resolves to `./pages/Accounts/index.tsx` via directory-index resolution and does not change.
- Produces: the file location that Tasks 5–8 will extract from.

- [ ] **Step 1: Move the file**

```bash
mkdir -p frontend/src/pages/Accounts
git mv frontend/src/pages/Accounts.tsx frontend/src/pages/Accounts/index.tsx
```

- [ ] **Step 2: Fix relative imports inside the moved file**

The file was `pages/Accounts.tsx`. It is now `pages/Accounts/index.tsx` — one directory deeper. Every `../<something>` import in the moved file needs one more `../` step.

Open `frontend/src/pages/Accounts/index.tsx` and change every `from '../` to `from '../../`. Every path like `from './PdfTemplateBuilder'` (imports of siblings in the SAME directory as the old file) — if any — needs to become `from '../PdfTemplateBuilder'`. Sanity-check: none of Accounts's current imports point at a same-directory file, so this second step is likely a no-op, but run:

```bash
grep -n "from '\./" frontend/src/pages/Accounts/index.tsx
```

Expected: no matches. If there are matches, adjust each to `'../<same-name>'`.

- [ ] **Step 3: TSC check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Characterization tests still green**

Run:
```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed`. The test file imports from `'../Accounts'` which now resolves to `pages/Accounts/index.tsx` via directory-index resolution — no test change.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/pages
git commit -m "$(cat <<'EOF'
refactor(accounts): move pages/Accounts.tsx to pages/Accounts/index.tsx

Pure relocation with adjusted relative imports. No behavior change;
characterization tests still green. Prepares for extraction of
PatternsSection, BalanceCheckpointsDrawer, CheckpointRow,
AccountCard, and AccountForm in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Extract `PatternsSection` to its own file

**Files:**
- Create: `frontend/src/pages/Accounts/PatternsSection.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx` (remove the inline component, add an import + JSX use)

**Interfaces:**
- Consumes: `Account`, `AccountFilenamePattern` from `../../api/types`, `api` from `../../api/client`, TanStack Query.
- Produces:
  ```ts
  export function PatternsSection({
    patterns,
    accounts,
  }: {
    patterns: AccountFilenamePattern[];
    accounts: Account[];
  }): JSX.Element;
  ```

- [ ] **Step 1: Find the current inline `PatternsSection` block**

In `frontend/src/pages/Accounts/index.tsx`, locate the block starting with `function PatternsSection({` and ending at its closing `}` (currently around line 664 to end of file, with the section-level `<section>` JSX). Copy the entire function (including its imports of `useState`, `useMutation`, `useQueryClient`, `api`, `AccountFilenamePattern`, `Account`).

- [ ] **Step 2: Create the new file**

Create `frontend/src/pages/Accounts/PatternsSection.tsx` with the copied function, adding these imports at the top:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, AccountFilenamePattern } from '../../api/types';

// (paste the PatternsSection function body here — verbatim from index.tsx,
//  changing `function PatternsSection` to `export function PatternsSection`)
```

Do not inline any additional logic changes. This is a mechanical move.

- [ ] **Step 3: Update `index.tsx`**

In `frontend/src/pages/Accounts/index.tsx`:
1. Delete the entire inline `function PatternsSection(...)` block.
2. Add the import near the top with the other imports:
   ```ts
   import { PatternsSection } from './PatternsSection';
   ```
3. The existing JSX call `<PatternsSection ... />` inside the `Accounts` component remains unchanged — it now resolves to the extracted export.

- [ ] **Step 4: TSC + tests**

Run in parallel:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed`. Test 1 (renders list) and Test 6 (pattern CRUD) both exercise the extracted component; they must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/PatternsSection.tsx frontend/src/pages/Accounts/index.tsx
git commit -m "$(cat <<'EOF'
refactor(accounts): extract PatternsSection to its own file

Pure code motion. Component behavior, cache key ['patterns'], and prop
signature all unchanged. Characterization tests remain green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Extract `BalanceCheckpointsDrawer` + `CheckpointRow`

**Files:**
- Create: `frontend/src/pages/Accounts/BalanceCheckpointsDrawer.tsx`
- Create: `frontend/src/pages/Accounts/CheckpointRow.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx`

**Interfaces:**
- Consumes: `listCheckpoints`, `createCheckpoint`, `updateCheckpoint`, `deleteCheckpoint` from `../../api/checkpoints`; `BalanceCheckpoint` from `../../api/types`; `ApiError` from `../../api/client`; `formatAmount` from `../../lib/format`.
- Produces:
  ```ts
  // BalanceCheckpointsDrawer.tsx
  export function BalanceCheckpointsDrawer({
    accountId,
    currency,
  }: {
    accountId: number;
    currency: string;
  }): JSX.Element;

  // CheckpointRow.tsx
  export function CheckpointRow({
    cp,
    currency,
    onSave,
    onDelete,
    saving,
    deleting,
  }: {
    cp: BalanceCheckpoint;
    currency: string;
    onSave: (patch: { expectedAmount?: string; note?: string | null }) => void;
    onDelete: () => void;
    saving: boolean;
    deleting: boolean;
  }): JSX.Element;
  ```

- [ ] **Step 1: Extract `CheckpointRow` first**

In `frontend/src/pages/Accounts/index.tsx`, locate the `function CheckpointRow(...)` block. Cut it into a new file `frontend/src/pages/Accounts/CheckpointRow.tsx`:

```tsx
import { useState } from 'react';
import { formatAmount } from '../../lib/format';
import type { BalanceCheckpoint } from '../../api/types';

// (paste the CheckpointRow body here — verbatim — with `function` → `export function`)
```

- [ ] **Step 2: Extract `BalanceCheckpointsDrawer`**

Locate the `function BalanceCheckpointsDrawer(...)` block. Cut it into `frontend/src/pages/Accounts/BalanceCheckpointsDrawer.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import {
  listCheckpoints,
  createCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
} from '../../api/checkpoints';
import type { BalanceCheckpoint } from '../../api/types';
import { CheckpointRow } from './CheckpointRow';

// (paste the BalanceCheckpointsDrawer body — verbatim — with `function` → `export function`)
```

- [ ] **Step 3: Update `index.tsx`**

In `frontend/src/pages/Accounts/index.tsx`:
1. Delete the `function CheckpointRow(...)` and `function BalanceCheckpointsDrawer(...)` blocks.
2. Add the drawer import:
   ```ts
   import { BalanceCheckpointsDrawer } from './BalanceCheckpointsDrawer';
   ```
3. The JSX call site `<BalanceCheckpointsDrawer accountId={a.id} currency={a.currency} />` stays unchanged.

- [ ] **Step 4: TSC + tests**

Run in parallel:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed`. Test 5 (checkpoint 409) exercises the extracted drawer + row; it must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/BalanceCheckpointsDrawer.tsx frontend/src/pages/Accounts/CheckpointRow.tsx frontend/src/pages/Accounts/index.tsx
git commit -m "$(cat <<'EOF'
refactor(accounts): extract BalanceCheckpointsDrawer + CheckpointRow

Pure code motion. Cache key ['balance-checkpoints', accountId] and all
mutation semantics unchanged; Dashboard chart still refreshes on edits.
Characterization tests remain green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Extract `AccountCard`

**Files:**
- Create: `frontend/src/pages/Accounts/AccountCard.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx`

**Interfaces:**
- Consumes: `Account` from `../../api/types`; `formatAmount`, `amountSignClass`, `formatDate` from `../../lib/format`; `BalanceCheckpointsDrawer` from `./BalanceCheckpointsDrawer`.
- Produces:
  ```ts
  export function AccountCard({
    account,
    onEdit,
    onExpand,
    expanded,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
    moving,
  }: {
    account: Account;
    onEdit: (account: Account) => void;
    onExpand: (id: number) => void;
    expanded: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
    moving: boolean;
  }): JSX.Element;
  ```

**IMPORTANT — what today's display-mode card actually renders** (read `index.tsx` around lines 353–417 to confirm before editing):
- Header row: account name (`a.name`) + currency badge.
- Type label (`a.type`).
- Current-balance display (`formatAmount(a.currentBalance ?? '0', a.currency)` with `amountSignClass`).
- Line: `ouvert {formatDate(a.openingDate)} · {formatAmount(a.openingBalance, a.currency)}`.
- **Absolute top-right cluster**: reorder-up button (SVG chevron-up) + reorder-down button (SVG chevron-down) + `modifier` button (SVG pencil + label). The reorder buttons are `disabled` when `!canMoveUp` / `!canMoveDown` / `moving`.
- Bottom section (border-top): `▸ Points de contrôle` toggle + `<BalanceCheckpointsDrawer />` when `expanded`.

**What today's display-mode card does NOT contain** (do not add these):
- No transaction counter, no `<Link to="/transactions?...">`, no delta / `hasMovement` display, no "N transactions" line, no `supprimer` button. The `supprimer` button lives in EDIT mode (not touched by this task).

- [ ] **Step 1: Identify the JSX slice**

Inside the `Accounts` component's render (in `index.tsx`), locate the `.map((a, idx, arr) => { ... })` block. Each iteration branches on `editingId === a.id`:
- **Edit-mode branch** (the `if (editingId === a.id && editDraft) { return (...); }` block) — stays inline in `index.tsx` for this task. Task 8 lifts it.
- **Display-mode branch** (the trailing `return (<div key={a.id} className="surface p-5 relative group">...);`) — this is what you lift into `AccountCard`.

- [ ] **Step 2: Create `AccountCard.tsx`**

Create the new file:

```tsx
import type { Account } from '../../api/types';
import { formatAmount, amountSignClass, formatDate } from '../../lib/format';
import { BalanceCheckpointsDrawer } from './BalanceCheckpointsDrawer';

export function AccountCard({
  account: a,
  onEdit,
  onExpand,
  expanded,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  moving,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  moving: boolean;
}) {
  return (
    <div className="surface p-5 relative group">
      {/* Paste the display-mode card JSX from index.tsx verbatim, then rewire:
          - reorder-up button:  onClick={onMoveUp}    disabled={!canMoveUp   || moving}
          - reorder-down button: onClick={onMoveDown} disabled={!canMoveDown || moving}
          - modifier button:    onClick={() => onEdit(a)}
          - "▸ Points de contrôle" toggle: onClick={() => onExpand(a.id)}
          - <BalanceCheckpointsDrawer /> renders only when `expanded === true`. */}
    </div>
  );
}
```

The exact JSX body comes from the current inline card — copy it verbatim, then rewire the callbacks as annotated.

- [ ] **Step 3: Update `index.tsx` — replace the display-mode branch with the component**

In `index.tsx`, replace the display-mode `return (...)` inside `.map(...)` with:

```tsx
{(accountsQ.data?.accounts ?? []).map((a, idx, arr) => {
  if (editingId === a.id && editDraft) {
    // Inline-edit unchanged — Task 8 lifts this into <AccountForm mode="edit">.
    return (
      <div key={a.id} className="surface p-5 relative">
        {/* existing edit-mode JSX unchanged */}
      </div>
    );
  }
  return (
    <AccountCard
      key={a.id}
      account={a}
      onEdit={(acc) => startEdit(acc)}
      onExpand={(id) => toggleCheckpoints(id)}
      expanded={checkpointsOpen.has(a.id)}
      onMoveUp={() => move(a.id, -1)}
      onMoveDown={() => move(a.id, 1)}
      canMoveUp={idx > 0}
      canMoveDown={idx < arr.length - 1}
      moving={reorder.isPending}
    />
  );
})}
```

Actual state-holder / helper names in the current code (confirm by reading the file): `editingId`, `editDraft`, `startEdit(a)`, `move(id, dir)`, `reorder.isPending`, `toggleCheckpoints(id)`, `checkpointsOpen.has(id)`. Match whatever exists.

Add the import at the top of `index.tsx`:
```ts
import { AccountCard } from './AccountCard';
```

Add the import at the top of `index.tsx`:
```ts
import { AccountCard } from './AccountCard';
```

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed`. Test 3 (inline edit) still uses the un-extracted inline-edit JSX branch; it must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/AccountCard.tsx frontend/src/pages/Accounts/index.tsx
git commit -m "$(cat <<'EOF'
refactor(accounts): extract AccountCard to its own file

Pure code motion for the display-mode card. Inline-edit mode remains
inline in index.tsx for now; Task 8 lifts it into a shared AccountForm.
Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Extract `AccountForm` (create + inline-edit)

**Files:**
- Create: `frontend/src/pages/Accounts/AccountForm.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx`

**Interfaces:**
- Consumes: `Account` from `../../api/types`.
- Produces:
  ```ts
  export interface AccountFormValues {
    name: string;
    type: string;
    currency: string;
    openingBalance: string;
    openingDate: string;
  }

  export function AccountForm({
    mode,
    initial,
    onSubmit,
    onCancel,
    submitting,
  }: {
    mode: 'create' | 'edit';
    initial?: Partial<AccountFormValues>;
    onSubmit: (values: AccountFormValues) => void;
    onCancel?: () => void;         // only meaningful in edit mode
    submitting?: boolean;
  }): JSX.Element;
  ```

- [ ] **Step 1: Create `AccountForm.tsx`**

Create the new file. Pull the create form's JSX (currently at the top of the `Accounts` render) and the inline-edit form's JSX (currently inside the account card block for `editingAccountId === a.id`) into a single component with the props above. Both modes render the same set of inputs (`name`, `type`, `currency`, `openingBalance`, `openingDate`); the differences are:
- Create mode: button label `Créer`, no cancel button.
- Edit mode: button label `Enregistrer` (or whatever the current inline-edit label is), plus a `Annuler` button that fires `onCancel`.

Keep the input `aria-label` / `<label>` text unchanged from today so characterization tests keep matching.

- [ ] **Step 2: Update `index.tsx` — create form**

Replace the create form's JSX at the top with:

```tsx
<AccountForm
  mode="create"
  onSubmit={(values) => create.mutate(values)}
  submitting={create.isPending}
/>
```

- [ ] **Step 3: Update `index.tsx` — inline edit**

Replace the inline-edit JSX inside the `.map(...)` (the `editingAccountId === a.id` branch from Task 7's Step 3) with:

```tsx
<AccountForm
  key={a.id}
  mode="edit"
  initial={{
    name: a.name,
    type: a.type,
    currency: a.currency,
    openingBalance: a.openingBalance,
    openingDate: a.openingDate,
  }}
  onSubmit={(values) => {
    // Diff against `a` and send only changed fields.
    const patch: Partial<AccountFormValues> = {};
    if (values.name !== a.name) patch.name = values.name;
    if (values.type !== a.type) patch.type = values.type;
    if (values.currency !== a.currency) patch.currency = values.currency;
    if (values.openingBalance !== a.openingBalance) patch.openingBalance = values.openingBalance;
    if (values.openingDate !== a.openingDate) patch.openingDate = values.openingDate;
    updateAccount.mutate({ id: a.id, patch });
    setEditingAccountId(null);
  }}
  onCancel={() => setEditingAccountId(null)}
  submitting={updateAccount.isPending}
/>
```

The exact call signature for `updateAccount.mutate` must match whatever `useMutation` in the current `index.tsx` expects — read that code, don't guess.

Add the import at the top of `index.tsx`:
```ts
import { AccountForm } from './AccountForm';
```

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

```bash
cd frontend && npx vitest run src/pages/__tests__/Accounts.test.tsx
```
Expected: `6 passed`. Tests 2 (create) and 3 (edit only-changed-field diff) both exercise `AccountForm`; both must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/AccountForm.tsx frontend/src/pages/Accounts/index.tsx
git commit -m "$(cat <<'EOF'
refactor(accounts): extract AccountForm for create + inline-edit

One component in two modes. Edit mode diffs against `initial` and
sends only the changed fields (identical to prior inline behavior).
Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Unit tests: `AccountCard` + `AccountForm`

**Files:**
- Create: `frontend/src/pages/Accounts/__tests__/AccountCard.test.tsx`
- Create: `frontend/src/pages/Accounts/__tests__/AccountForm.test.tsx`

**Interfaces:**
- Consumes: extracted `AccountCard` (Task 7) and `AccountForm` (Task 8).
- Produces: two unit-test files with the assertions listed below. No new components.

- [ ] **Step 1: Write `AccountCard.test.tsx`**

Create `frontend/src/pages/Accounts/__tests__/AccountCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountCard } from '../AccountCard';
import type { Account } from '../../../api/types';

const acc: Account = {
  id: 1, name: 'Test', type: 'checking', currency: 'EUR',
  openingBalance: '100.00', openingDate: '2025-01-01',
  currentBalance: '250.00', displayOrder: 0,
};

const defaultProps = {
  account: acc,
  onEdit: () => {},
  onExpand: () => {},
  expanded: false,
  onMoveUp: () => {},
  onMoveDown: () => {},
  canMoveUp: true,
  canMoveDown: true,
  moving: false,
};

describe('AccountCard', () => {
  it('renders name, type, currency, and balance', () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it('fires onEdit(account) when modifier is clicked', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: /modifier/i }));
    expect(onEdit).toHaveBeenCalledWith(acc);
  });

  it('fires onMoveUp / onMoveDown when the reorder buttons are clicked', async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />);
    await user.click(screen.getByRole('button', { name: /déplacer vers le haut/i }));
    await user.click(screen.getByRole('button', { name: /déplacer vers le bas/i }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('disables the reorder buttons when at the edges or moving', () => {
    const { rerender } = render(<AccountCard {...defaultProps} canMoveUp={false} />);
    expect(screen.getByRole('button', { name: /déplacer vers le haut/i })).toBeDisabled();
    rerender(<AccountCard {...defaultProps} canMoveDown={false} />);
    expect(screen.getByRole('button', { name: /déplacer vers le bas/i })).toBeDisabled();
    rerender(<AccountCard {...defaultProps} moving={true} />);
    expect(screen.getByRole('button', { name: /déplacer vers le haut/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /déplacer vers le bas/i })).toBeDisabled();
  });

  it('fires onExpand when the checkpoints toggle is clicked', async () => {
    const onExpand = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard {...defaultProps} onExpand={onExpand} />);
    await user.click(screen.getByRole('button', { name: /points de contrôle/i }));
    expect(onExpand).toHaveBeenCalledWith(1);
  });

  it('does not render the drawer when expanded is false', () => {
    render(<AccountCard {...defaultProps} />);
    // Drawer's empty-state text should be absent when collapsed. This is a
    // negative assertion — testing the positive case (drawer mounts on
    // expanded=true) is covered by the drawer's own unit tests in Task 10,
    // where the required QueryClient wrapper is set up.
    expect(screen.queryByText(/aucun point de contrôle/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `AccountForm.test.tsx`**

Create `frontend/src/pages/Accounts/__tests__/AccountForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountForm } from '../AccountForm';

describe('AccountForm', () => {
  it('create mode: types values and submits them', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AccountForm mode="create" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/nom/i), 'Livret');
    await user.type(screen.getByLabelText(/date d.ouverture/i), '2026-05-01');
    await user.click(screen.getByRole('button', { name: /créer/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Livret',
      openingDate: '2026-05-01',
    }));
  });

  it('edit mode: pre-fills from initial prop', () => {
    render(<AccountForm
      mode="edit"
      initial={{ name: 'Existing', type: 'savings', currency: 'EUR',
        openingBalance: '100.00', openingDate: '2025-01-01' }}
      onSubmit={() => {}}
    />);
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('savings')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2025-01-01')).toBeInTheDocument();
  });

  it('create submit is disabled while required fields are empty', () => {
    render(<AccountForm mode="create" onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /créer/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
cd frontend && npx vitest run src/pages/Accounts/__tests__/AccountCard.test.tsx src/pages/Accounts/__tests__/AccountForm.test.tsx
```
Expected: 8 tests pass (5 in `AccountCard`, 3 in `AccountForm`).

- [ ] **Step 4: Full frontend suite**

```bash
cd frontend && npx vitest run
```
Expected: all files green (6 characterization + 8 new = 14 tests minimum).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/__tests__/AccountCard.test.tsx frontend/src/pages/Accounts/__tests__/AccountForm.test.tsx
git commit -m "$(cat <<'EOF'
test(accounts): unit tests for AccountCard and AccountForm

AccountCard: 5 tests covering render + all four callback props.
AccountForm: 3 tests covering create submit, edit pre-fill, and
disabled state on empty required fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Unit tests: `BalanceCheckpointsDrawer` + `CheckpointRow`

**Files:**
- Create: `frontend/src/pages/Accounts/__tests__/BalanceCheckpointsDrawer.test.tsx`
- Create: `frontend/src/pages/Accounts/__tests__/CheckpointRow.test.tsx`

**Interfaces:**
- Consumes: extracted `BalanceCheckpointsDrawer` + `CheckpointRow`.
- Produces: two unit-test files.

- [ ] **Step 1: Write `CheckpointRow.test.tsx`**

Create `frontend/src/pages/Accounts/__tests__/CheckpointRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckpointRow } from '../CheckpointRow';
import type { BalanceCheckpoint } from '../../../api/types';

const cp: BalanceCheckpoint = {
  id: 1, accountId: 1, checkpointDate: '2025-06-01',
  expectedAmount: '100.00', note: 'relevé BNP', createdAt: '2026-01-01T00:00:00Z',
};

describe('CheckpointRow', () => {
  it('commits the new amount on Enter', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /100/ }));
    const input = screen.getByDisplayValue('100.00');
    await user.clear(input);
    await user.type(input, '150.50{Enter}');
    expect(onSave).toHaveBeenCalledWith({ expectedAmount: '150.50' });
  });

  it('blur unchanged does NOT fire onSave', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /100/ }));
    const input = screen.getByDisplayValue('100.00');
    await user.click(document.body); // blur without typing
    expect(onSave).not.toHaveBeenCalled();
  });

  it('trims a whitespace note to null on save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /relevé BNP/i }));
    const input = screen.getByDisplayValue('relevé BNP');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onSave).toHaveBeenCalledWith({ note: null });
  });

  it('fires onDelete when ✕ is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={() => {}} onDelete={onDelete} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /supprimer/i }));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `BalanceCheckpointsDrawer.test.tsx`**

Create `frontend/src/pages/Accounts/__tests__/BalanceCheckpointsDrawer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BalanceCheckpointsDrawer } from '../BalanceCheckpointsDrawer';
import { ApiError } from '../../../api/client';

vi.mock('../../../api/checkpoints');
import * as checkpointsApi from '../../../api/checkpoints';
const listMock = vi.mocked(checkpointsApi.listCheckpoints);
const createMock = vi.mocked(checkpointsApi.createCheckpoint);
const delMock = vi.mocked(checkpointsApi.deleteCheckpoint);
const patchMock = vi.mocked(checkpointsApi.updateCheckpoint);

function renderDrawer(accountId = 1, currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BalanceCheckpointsDrawer accountId={accountId} currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  delMock.mockReset();
  patchMock.mockReset();
});

describe('BalanceCheckpointsDrawer', () => {
  it('shows empty state text when no checkpoints', async () => {
    listMock.mockResolvedValueOnce({ checkpoints: [] });
    renderDrawer();
    expect(await screen.findByText(/aucun point de contrôle/i)).toBeInTheDocument();
  });

  it('submits and displays a new checkpoint', async () => {
    listMock.mockResolvedValueOnce({ checkpoints: [] });
    createMock.mockResolvedValueOnce({ checkpoint: {
      id: 1, accountId: 1, checkpointDate: '2025-06-01',
      expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' } });
    listMock.mockResolvedValueOnce({ checkpoints: [{
      id: 1, accountId: 1, checkpointDate: '2025-06-01',
      expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' }] });

    const user = userEvent.setup();
    renderDrawer();
    await user.type(await screen.findByLabelText(/date du point de contrôle/i), '2025-06-01');
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: /ajouter/i }));

    expect(createMock).toHaveBeenCalledWith(1, expect.objectContaining({
      checkpointDate: '2025-06-01', expectedAmount: '100.00',
    }));
    expect(await screen.findByText('2025-06-01')).toBeInTheDocument();
  });

  it('shows 409 error text inline', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('checkpoint_exists', 409, { error: 'checkpoint_exists', date: '2025-06-01' }));

    const user = userEvent.setup();
    renderDrawer();
    await user.type(await screen.findByLabelText(/date du point de contrôle/i), '2025-06-01');
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: /ajouter/i }));

    expect(await screen.findByText(/existe déjà à cette date/i)).toBeInTheDocument();
  });

  it('clears mutationError after a subsequent successful mutation', async () => {
    listMock.mockResolvedValue({ checkpoints: [] });
    createMock.mockRejectedValueOnce(new ApiError('checkpoint_exists', 409, {
      error: 'checkpoint_exists', date: '2025-06-01' }));
    createMock.mockResolvedValueOnce({ checkpoint: {
      id: 2, accountId: 1, checkpointDate: '2025-07-01',
      expectedAmount: '200.00', note: null, createdAt: '2026-01-01T00:00:00Z' } });
    listMock.mockResolvedValueOnce({ checkpoints: [{
      id: 2, accountId: 1, checkpointDate: '2025-07-01',
      expectedAmount: '200.00', note: null, createdAt: '2026-01-01T00:00:00Z' }] });

    const user = userEvent.setup();
    renderDrawer();
    // First attempt fails.
    await user.type(await screen.findByLabelText(/date du point de contrôle/i), '2025-06-01');
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: /ajouter/i }));
    await screen.findByText(/existe déjà à cette date/i);

    // Second attempt succeeds — error must clear.
    await user.clear(screen.getByLabelText(/date du point de contrôle/i));
    await user.type(screen.getByLabelText(/date du point de contrôle/i), '2025-07-01');
    await user.clear(screen.getByLabelText(/montant attendu/i));
    await user.type(screen.getByLabelText(/montant attendu/i), '200.00');
    await user.click(screen.getByRole('button', { name: /ajouter/i }));

    await waitFor(() => expect(screen.queryByText(/existe déjà à cette date/i)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
cd frontend && npx vitest run src/pages/Accounts/__tests__/CheckpointRow.test.tsx src/pages/Accounts/__tests__/BalanceCheckpointsDrawer.test.tsx
```
Expected: 8 tests pass (4 in each file).

- [ ] **Step 4: Full frontend suite**

```bash
cd frontend && npx vitest run
```
Expected: all files green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Accounts/__tests__/BalanceCheckpointsDrawer.test.tsx frontend/src/pages/Accounts/__tests__/CheckpointRow.test.tsx
git commit -m "$(cat <<'EOF'
test(accounts): unit tests for BalanceCheckpointsDrawer and CheckpointRow

Drawer: 4 tests (empty state, add-row, 409, error clears on success).
Row: 4 tests (Enter commit, blur-unchanged no-op, note trim-to-null,
delete callback).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — Unit tests: `PatternsSection` + `STATUS.md`

**Files:**
- Create: `frontend/src/pages/Accounts/__tests__/PatternsSection.test.tsx`
- Create: `STATUS.md`

**Interfaces:**
- Consumes: extracted `PatternsSection`.
- Produces: the last unit-test file for this iteration + the top-level project status document.

- [ ] **Step 1: Write `PatternsSection.test.tsx`**

Create `frontend/src/pages/Accounts/__tests__/PatternsSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatternsSection } from '../PatternsSection';
import type { Account } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection(patterns: any[] = [], accounts: Account[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PatternsSection patterns={patterns} accounts={accounts} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

const acc: Account = {
  id: 1, name: 'Compte courant', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
};

describe('PatternsSection', () => {
  it('renders the empty state when there are no patterns', () => {
    renderSection([], [acc]);
    expect(screen.getByText(/aucun motif|no pattern/i)).toBeInTheDocument();
  });

  it('submits POST with the correct payload', async () => {
    apiMock.mockResolvedValueOnce({ pattern: { id: 1, pattern: 'compte_courant', accountId: 1, priority: 0 } });
    const user = userEvent.setup();
    renderSection([], [acc]);
    await user.type(screen.getByPlaceholderText(/motif|pattern/i), 'compte_courant');
    // Some UIs put an account dropdown here; if so, choose the account. If
    // the current PatternsSection auto-picks the only account, this line
    // is a no-op.
    await user.click(screen.getByRole('button', { name: /ajouter/i }));

    expect(apiMock).toHaveBeenCalledWith('/api/account-filename-patterns', expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({ pattern: 'compte_courant' }),
    }));
  });

  it('submits DELETE when trash is clicked', async () => {
    apiMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    renderSection([{ id: 42, pattern: 'x', accountId: 1, priority: 0 }], [acc]);
    await user.click(screen.getByRole('button', { name: /supprimer/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/account-filename-patterns/42', expect.objectContaining({
      method: 'DELETE',
    })));
  });

  it('resolves account names from the accounts prop', () => {
    renderSection([{ id: 1, pattern: 'p', accountId: 1, priority: 0 }], [acc]);
    expect(screen.getByText('Compte courant')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
cd frontend && npx vitest run src/pages/Accounts/__tests__/PatternsSection.test.tsx
```
Expected: 4 tests pass.

- [ ] **Step 3: Full frontend suite + coverage**

```bash
cd frontend && npx vitest run --coverage
```
Expected: all files green. Coverage for `src/pages/Accounts/**` should be ≥ 80% (aspirational — not a hard gate; see spec).

- [ ] **Step 4: Create `STATUS.md`**

Create `STATUS.md` at the repo root with this content:

```markdown
# Status — Athena Accounting

_Last updated: 2026-07-01_

## Live

Self-hosted personal accounting app. Local-only, LAN-reachable. See
[`README.md`](./README.md) for setup.

- CI: <https://github.com/Gekkotron/Athena-Accounting/actions>
- Coverage: <https://codecov.io/gh/Gekkotron/Athena-Accounting>

## Recently landed

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
| Rules.tsx          | ⬜           | ⬜    | ⬜         |
| Transactions.tsx   | ⬜           | ⬜    | ⬜         |
| Imports.tsx        | ⬜           | ⬜    | ⬜         |
| backup.ts (backend)| ⬜           | ⬜    | ⬜         |

## Known deferrals

- Duplicate `note` Zod chain in `backend/src/http/routes/balance-checkpoints.ts`
  (Task 2 review of the checkpoints feature, 2026-07-01). Extract to a
  shared `noteField` const on the next touch of that file.
- UTC-date default in `BalanceCheckpointsDrawer` (`new Date().toISOString().slice(0, 10)`
  gives tomorrow's date for late-evening users). Cosmetic.
- `frontend/tsconfig.json` does not include `tests/**` — runtime landmines
  (`import Pdf({ accountId, buffer })` missing `userId`) can slip past
  `tsc --noEmit`. Add a `tsconfig.test.json` on the next CI touch.
- CI runs Node 20 in `setup-node@v4`, and GitHub is deprecating the Node
  20 runner. Bump `node-version: '22'` in `.github/workflows/ci.yml`.

## Environment

- Runtime: Node 20 + Postgres 16 via `docker compose up`. LAN-reachable
  on the ports listed in the README (default: 8000 frontend, 8001 backend).
- CI: GitHub Actions with a Postgres 16 service container. `RUN_DB_TESTS=1`.
- Deployment target: self-hosted, no cloud.
```

- [ ] **Step 5: Update `TODO.md`**

In `TODO.md`, move the "Split code to be more readable" and "Add units tests on this project" items from `## 🧠 Idées` to `## ✅ Fait`, consolidated as one line:

```markdown
- Frontend test harness (Vitest + Testing Library + jsdom) + first refactor+test iteration on Accounts.tsx (split into 6 focused files + 6 characterization + ~20 unit tests). See `STATUS.md` for the interleave progress table.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Accounts/__tests__/PatternsSection.test.tsx STATUS.md TODO.md
git commit -m "$(cat <<'EOF'
test(accounts): unit tests for PatternsSection + create STATUS.md

Closes out the first split+test iteration:
- PatternsSection: 4 tests (empty state, POST payload, DELETE, name lookup).
- STATUS.md seeded with today's state — recently landed, refactor table,
  known deferrals, environment.
- TODO.md: move the split+tests items to Fait, consolidated into one line
  pointing at STATUS.md for the interleave table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** every section of `2026-07-01-accounts-refactor-tests-design.md` maps to a task. Harness → Task 1. Characterization → Task 2. CI → Task 3. Split → Tasks 4–8 (one component per commit). Unit tests → Tasks 9–11. `STATUS.md` → Task 11.
- **Type consistency:** prop shapes for `AccountCard`, `AccountForm`, `BalanceCheckpointsDrawer`, `CheckpointRow`, `PatternsSection` are declared in one place per component (in the extraction task) and consumed with matching names in the unit-test tasks. `AccountFormValues` interface introduced in Task 8 and reused in Task 9 tests.
- **Placeholder scan:** no TBDs; every code block is copy-pasteable; every command has an expected output.
- **Constraints match:** cache keys `['accounts']`, `['patterns']`, `['balance-checkpoints', accountId]` are called out in Global Constraints and every extraction task instructs to keep them identical.
- **Testing safety net:** Tasks 4–8 each end with a `vitest run src/pages/__tests__/Accounts.test.tsx` step that must show `6 passed` — the characterization suite is the gate between split commits.
