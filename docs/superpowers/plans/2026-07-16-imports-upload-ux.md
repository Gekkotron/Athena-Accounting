# Imports Upload UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three additive improvements to the Imports upload flow — a drag-and-drop zone around the file picker, a preview-before-import step for OFX/CSV single-file uploads, and per-item retry from the batch summary — without touching parsing, dedup, categorization, or transfer detection.

**Architecture:** One new backend endpoint (`POST /api/imports/preview`) that reuses the existing parsers via a new side-effect-free `preview-service.ts`. One new modal component (`ImportPreviewModal`) that shows parsed rows + dedup analysis before the user confirms. All UploadForm changes stay in that one file (drop handler on the file column, preview branch on OFX/CSV single-file submit, retained `File` objects in the batch summary state).

**Tech Stack:** Fastify 5 + Drizzle ORM + PostgreSQL on the backend; React 18 + TypeScript + `@tanstack/react-query` + Tailwind on the frontend. Tests use Vitest everywhere; frontend tests use `@testing-library/react` + `@testing-library/user-event`. Package manager is **npm per subproject** (no workspace root) — backend commands are `cd backend && npm ...`, frontend commands are `cd frontend && npm ...`.

## Global Constraints

- **Public-safe commits** — never commit IPs, hostnames, or secrets; project is going public.
- **Commit directly on `main`** — no feature branches. Do not push unless the user asks.
- **Attribute commits to Gekkotron** — every `git commit` must be prefixed with `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
- **Never launch OrbStack / Docker** — do not start container runtimes. If the DB isn't up, run only the non-DB tests (`RUN_DB_TESTS` unset) and note DB-tests-deferred in the commit body; do not try to start Postgres.
- **French decimal inputs** — never use `<input type="number">`. This plan adds no numeric inputs, but the constraint stands for any tweak.
- **French UI copy verbatim** — labels below appear in the UI exactly as spelled: `Prévisualiser`, `Importer`, `Annuler`, `Nouveau`, `Doublon`, `nouvelles`, `dédupliquées`, `sur`, `Réessayer`, `Réessayer tout`, `Fermer`, `Glissez un fichier ici ou`, `parcourir`, `voir tout`.
- **PDF single-file, photo, and batch (>1 file) paths all skip the preview modal** — they keep today's behavior verbatim.
- **Preview endpoint is read-only** — it must never create a `fileImports` row and must never insert into `transactions`.
- **No new file formats and no new sources/connectors in this plan** — those are deferred sub-projects (see the design doc for scope split).
- **Every file touched by this plan must end under 300 lines.** Files I don't need to touch are grandfathered as-is, but any file this plan creates or modifies (including baseline files that are already over 300, like `frontend/src/pages/Imports/UploadForm.tsx` at 329 lines) must come out under 300. That means: put the new backend preview route in its own file (Task 1 now creates `backend/src/http/routes/imports-preview.ts` instead of appending to `imports.ts`, and only registers it in `server.ts`), and extract subcomponents / hooks from `UploadForm.tsx` as new features land (Tasks 4/5/6 each create one extraction so the coordinator stays small).

---

### Task 1: Backend — `POST /api/imports/preview` endpoint + `preview-service`

**Files:**
- Create: `backend/src/domain/imports/preview-service.ts`
- Create: `backend/src/http/routes/imports-preview.ts` (new Fastify plugin file; keeps `imports.ts` untouched to respect the 300-line constraint)
- Modify: `backend/src/server.ts` (register the new plugin alongside `importsRoutes`)
- Create: `backend/tests/imports-preview-route.test.ts`

**Interfaces:**
- Consumes: existing `parseOfx` from `./ofx-parser.js`, `parseFrenchCsv` from `./csv-parser.js`, `computeDedupKey` from `./dedup.js`, `normalizeLabel` from `./normalize.js`, `resolveAccountFromFilename` + `inferFormat` from `./import-service.js` (all already exported).
- Produces: `previewImport(opts: { filename: string; accountId: number; userId: number; format: 'ofx' | 'csv'; buffer: Buffer }): Promise<PreviewResult>` and the `PreviewResult` type — consumed by the route and, indirectly, by Task 2's frontend helper (matching JSON shape).

- [ ] **Step 1: Write the failing unit test for `previewImport`**

Create `backend/src/domain/imports/__tests__/preview-service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { previewImport, type PreviewResult } from '../preview-service.js';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountId: number;

describe.skipIf(!RUN)('previewImport', () => {
  beforeAll(async () => {
    const { db } = await import('../../../db/client.js');
    const { users, accounts } = await import('../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'preview-user',
      passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Preview Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.delete(transactions);
  });

  it('splits parsed rows into newRows and duplicateRows against an empty ledger', async () => {
    const csv = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n16/06/2026;Salaire;2000,00\n';
    const result: PreviewResult = await previewImport({
      filename: 'test.csv',
      accountId,
      userId,
      format: 'csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    expect(result.filename).toBe('test.csv');
    expect(result.format).toBe('csv');
    expect(result.accountId).toBe(accountId);
    expect(result.totalRows).toBe(2);
    expect(result.newRows).toHaveLength(2);
    expect(result.duplicateRows).toHaveLength(0);
  });

  it('flags rows that already exist in the ledger as duplicates', async () => {
    // Seed one matching row via a real import first.
    const { runImport } = await import('../import-service.js');
    const csvSeed = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n';
    await runImport({
      filename: 'seed.csv',
      accountId, userId, format: 'csv',
      buffer: Buffer.from(csvSeed, 'utf-8'),
    });

    // Now preview a file with the same row + a new row.
    const csvPreview = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n17/06/2026;Nouveau;-5,00\n';
    const result = await previewImport({
      filename: 'again.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(csvPreview, 'utf-8'),
    });
    expect(result.totalRows).toBe(2);
    expect(result.newRows).toHaveLength(1);
    expect(result.newRows[0]!.rawLabel).toBe('Nouveau');
    expect(result.duplicateRows).toHaveLength(1);
    expect(result.duplicateRows[0]!.rawLabel).toBe('Café');
  });

  it('never inserts a fileImports row or a transactions row', async () => {
    const { db } = await import('../../../db/client.js');
    const { fileImports, transactions } = await import('../../../db/schema.js');
    const csv = 'Date;Libellé;Montant\n15/06/2026;X;-1,00\n';
    await previewImport({
      filename: 'x.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    const fi = await db.select().from(fileImports);
    const tx = await db.select().from(transactions);
    expect(fi).toHaveLength(0);
    expect(tx).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npm test -- preview-service
```

Expected: FAIL — `preview-service.js` module not found. If `RUN_DB_TESTS` is unset the suite is skipped instead; that's still a valid "no green pass yet" state.

- [ ] **Step 3: Implement `preview-service.ts`**

Create `backend/src/domain/imports/preview-service.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { parseOfx, type ParsedTransaction } from './ofx-parser.js';
import { parseFrenchCsv } from './csv-parser.js';
import { normalizeLabel } from './normalize.js';
import { computeDedupKey } from './dedup.js';

export interface PreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface PreviewResult {
  filename: string;
  format: 'ofx' | 'csv';
  accountId: number;
  totalRows: number;
  newRows: PreviewRow[];
  duplicateRows: PreviewRow[];
}

function parse(buf: Buffer, format: 'ofx' | 'csv'): ParsedTransaction[] {
  return format === 'ofx' ? parseOfx(buf) : parseFrenchCsv(buf);
}

export async function previewImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: 'ofx' | 'csv';
  buffer: Buffer;
}): Promise<PreviewResult> {
  const parsed = parse(opts.buffer, opts.format);
  if (parsed.length === 0) {
    return {
      filename: opts.filename,
      format: opts.format,
      accountId: opts.accountId,
      totalRows: 0,
      newRows: [],
      duplicateRows: [],
    };
  }

  const withKeys = parsed.map((p) => ({
    row: {
      date: p.date,
      amount: p.amount,
      rawLabel: p.rawLabel,
      memo: p.memo,
    } satisfies PreviewRow,
    dedupKey: computeDedupKey({
      accountId: opts.accountId,
      date: p.date,
      amount: p.amount,
      normalizedLabel: normalizeLabel(p.rawLabel),
      fitid: p.fitid,
    }),
  }));

  const existing = await db
    .select({ dedupKey: transactions.dedupKey })
    .from(transactions)
    .where(and(
      eq(transactions.accountId, opts.accountId),
      inArray(transactions.dedupKey, withKeys.map((w) => w.dedupKey)),
    ));
  const seen = new Set(existing.map((r) => r.dedupKey));

  const newRows: PreviewRow[] = [];
  const duplicateRows: PreviewRow[] = [];
  for (const w of withKeys) {
    if (seen.has(w.dedupKey)) duplicateRows.push(w.row);
    else newRows.push(w.row);
  }

  return {
    filename: opts.filename,
    format: opts.format,
    accountId: opts.accountId,
    totalRows: parsed.length,
    newRows,
    duplicateRows,
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
cd backend && RUN_DB_TESTS=1 npm test -- preview-service
```

Expected: PASS (3 tests). If Postgres isn't reachable, the suite is skipped — see the "OrbStack" global constraint; commit anyway and note DB-tests-deferred.

- [ ] **Step 5: Write the failing integration test for the route**

Create `backend/tests/imports-preview-route.test.ts`:

```ts
// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;

async function buildForm(filename: string, contents: string | Buffer, contentType: string) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  const buf = typeof contents === 'string' ? Buffer.from(contents) : contents;
  form.append('file', buf, { filename, contentType });
  return { headers: form.getHeaders(), payload: form.getBuffer() };
}

describe.skipIf(!RUN)('/api/imports/preview', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'prev-user', password: 'prev-user-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'prev-user', password: 'prev-user-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const { db } = await import('../src/db/client.js');
    const { accounts, users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [u] = await db.select().from(users).where(eq(users.username, 'prev-user'));
    const [a] = await db.insert(accounts).values({
      userId: u!.id, name: 'Preview Route', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { fileImports, transactions } = await import('../src/db/schema.js');
    await db.delete(transactions);
    await db.delete(fileImports);
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/imports/preview?accountId=${accountId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for a PDF file', async () => {
    const { headers, payload } = await buildForm('statement.pdf', '%PDF-1.4', 'application/pdf');
    const res = await app.inject({
      method: 'POST', url: `/api/imports/preview?accountId=${accountId}`,
      headers: { cookie, ...headers }, payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pdf/i);
  });

  it('returns 400 for an unsupported extension', async () => {
    const { headers, payload } = await buildForm('note.txt', 'x', 'text/plain');
    const res = await app.inject({
      method: 'POST', url: `/api/imports/preview?accountId=${accountId}`,
      headers: { cookie, ...headers }, payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported file extension/i);
  });

  it('returns 400 when no accountId is passed and no filename pattern matches', async () => {
    const { headers, payload } = await buildForm(
      'nopattern.csv',
      'Date;Libellé;Montant\n15/06/2026;X;-1,00\n',
      'text/csv',
    );
    const res = await app.inject({
      method: 'POST', url: '/api/imports/preview',
      headers: { cookie, ...headers }, payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('parses a CSV and returns newRows / duplicateRows without side effects', async () => {
    const csv = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n16/06/2026;Salaire;2000,00\n';
    const { headers, payload } = await buildForm('preview.csv', csv, 'text/csv');
    const res = await app.inject({
      method: 'POST', url: `/api/imports/preview?accountId=${accountId}`,
      headers: { cookie, ...headers }, payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.filename).toBe('preview.csv');
    expect(body.format).toBe('csv');
    expect(body.accountId).toBe(accountId);
    expect(body.totalRows).toBe(2);
    expect(body.newRows).toHaveLength(2);
    expect(body.duplicateRows).toHaveLength(0);

    // No side effects.
    const { db } = await import('../src/db/client.js');
    const { fileImports, transactions } = await import('../src/db/schema.js');
    expect(await db.select().from(fileImports)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the route test to verify it fails**

```bash
cd backend && RUN_DB_TESTS=1 npm test -- imports-preview-route
```

Expected: FAIL — route not registered, `POST /api/imports/preview` returns 404.

- [ ] **Step 7: Create the preview route plugin file**

Create `backend/src/http/routes/imports-preview.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { inferFormat, resolveAccountFromFilename } from '../../domain/imports/import-service.js';
import { previewImport } from '../../domain/imports/preview-service.js';
import { userId } from '../plugins/auth.js';

export async function importsPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports/preview', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, or .pdf)' });
    }
    if (format === 'pdf') {
      return reply.code(400).send({ error: 'preview not supported for PDF, use the template wizard' });
    }

    const q = req.query as { accountId?: string };
    let accountId: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountId = n;
    } else {
      accountId = await resolveAccountFromFilename(userId(req), filename);
    }
    if (!accountId) {
      return reply.code(400).send({
        error: 'cannot determine target account; pass ?accountId=N or configure a filename pattern',
      });
    }

    try {
      const result = await previewImport({
        filename, accountId, userId: userId(req), format, buffer,
      });
      return reply.code(200).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'preview failed');
      return reply.code(400).send({
        error: 'preview failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
```

- [ ] **Step 7b: Register the plugin in `server.ts`**

Modify `backend/src/server.ts`. Add the import near the existing `importsRoutes` import (line 13):

```ts
import { importsPreviewRoutes } from './http/routes/imports-preview.js';
```

Then add the registration line immediately below `await app.register(importsRoutes);` (line 63):

```ts
  await app.register(importsPreviewRoutes);
```

- [ ] **Step 8: Run the route test to verify it passes**

```bash
cd backend && RUN_DB_TESTS=1 npm test -- imports-preview-route
```

Expected: PASS (5 tests). If Postgres is unreachable the suite is skipped — commit anyway and note DB-tests-deferred.

- [ ] **Step 9: Type-check backend**

```bash
cd backend && npm run build
```

Expected: no TypeScript errors. The build only compiles; it doesn't need Postgres.

- [ ] **Step 10: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/domain/imports/preview-service.ts \
  backend/src/domain/imports/__tests__/preview-service.test.ts \
  backend/src/http/routes/imports-preview.ts \
  backend/src/server.ts \
  backend/tests/imports-preview-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(imports): add POST /api/imports/preview for OFX/CSV dry-run

Reuses the existing parseOfx / parseFrenchCsv parsers and the same
computeDedupKey + normalizeLabel helpers used by the real import path.
Runs one batched SELECT on transactions.(account_id, dedup_key) to split
parsed rows into newRows and duplicateRows. Creates no fileImports row
and inserts no transactions.

Rejects PDFs with a 400 (the template wizard is their preview step).
EOF
)"
```

---

### Task 2: Frontend — `previewImport` API helper

**Files:**
- Create: `frontend/src/api/imports.ts`
- Create: `frontend/src/api/__tests__/imports.test.ts`

**Interfaces:**
- Consumes: `apiUpload` from `../api/client` (existing).
- Produces: `previewImport(file: File, accountId?: number): Promise<ImportPreview>` and the `ImportPreview` / `ImportPreviewRow` types — consumed by the modal in Task 3 and by `UploadForm` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/__tests__/imports.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewImport, type ImportPreview } from '../imports';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, apiUpload: vi.fn() };
});
import { apiUpload } from '../client';
const uploadMock = vi.mocked(apiUpload);

beforeEach(() => uploadMock.mockReset());

describe('previewImport', () => {
  it('posts the file to /api/imports/preview with the accountId query when given', async () => {
    const payload: ImportPreview = {
      filename: 'x.csv',
      format: 'csv',
      accountId: 7,
      totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-3.50', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    };
    uploadMock.mockResolvedValue(payload);
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    const result = await previewImport(file, 7);
    expect(uploadMock).toHaveBeenCalledWith('/api/imports/preview', file, { query: { accountId: 7 } });
    expect(result).toEqual(payload);
  });

  it('omits the accountId query when accountId is undefined', async () => {
    uploadMock.mockResolvedValue({
      filename: 'y.csv', format: 'csv', accountId: 3, totalRows: 0,
      newRows: [], duplicateRows: [],
    });
    const file = new File(['x'], 'y.csv', { type: 'text/csv' });
    await previewImport(file);
    expect(uploadMock).toHaveBeenCalledWith('/api/imports/preview', file, { query: undefined });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npm test -- imports.test
```

Expected: FAIL — module `../imports` not found.

- [ ] **Step 3: Implement the API helper**

Create `frontend/src/api/imports.ts`:

```ts
import { apiUpload } from './client';

export interface ImportPreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface ImportPreview {
  filename: string;
  format: 'ofx' | 'csv';
  accountId: number;
  totalRows: number;
  newRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
}

export function previewImport(file: File, accountId?: number): Promise<ImportPreview> {
  return apiUpload<ImportPreview>(
    '/api/imports/preview',
    file,
    { query: accountId !== undefined ? { accountId } : undefined },
  );
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd frontend && npm test -- imports.test
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/api/imports.ts \
  frontend/src/api/__tests__/imports.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(frontend): add previewImport() API helper for /api/imports/preview

Thin wrapper over apiUpload. Emits the accountId query param only when
the caller passes it (otherwise the backend uses filename-pattern
resolution, matching the /api/imports contract).
EOF
)"
```

---

### Task 3: Frontend — `ImportPreviewModal` component

**Files:**
- Create: `frontend/src/pages/Imports/ImportPreviewModal.tsx`
- Create: `frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx`

**Interfaces:**
- Consumes: `ImportPreview` / `ImportPreviewRow` from `../../api/imports` (Task 2).
- Produces: `ImportPreviewModal` React component with props `{ preview: ImportPreview; onConfirm: () => void; onCancel: () => void; pending?: boolean }` — consumed by `UploadForm` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewModal } from '../ImportPreviewModal';
import type { ImportPreview } from '../../../api/imports';

const preview: ImportPreview = {
  filename: 'juin.csv',
  format: 'csv',
  accountId: 2,
  totalRows: 3,
  newRows: [
    { date: '2026-06-15', amount: '-3.50', rawLabel: 'Café', memo: null },
    { date: '2026-06-16', amount: '2000.00', rawLabel: 'Salaire', memo: null },
  ],
  duplicateRows: [
    { date: '2026-06-14', amount: '-10.00', rawLabel: 'Doublon', memo: null },
  ],
};

describe('ImportPreviewModal', () => {
  it('renders filename, counts summary, and every parsed row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/juin\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*nouvelles/)).toBeInTheDocument();
    expect(screen.getByText(/1\s*dédupliquée/)).toBeInTheDocument();
    expect(screen.getByText(/sur\s*3/)).toBeInTheDocument();
    expect(screen.getByText('Café')).toBeInTheDocument();
    expect(screen.getByText('Salaire')).toBeInTheDocument();
    expect(screen.getByText('Doublon')).toBeInTheDocument();
  });

  it('tags new rows as "Nouveau" and duplicate rows as "Doublon"', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    const nouveaux = screen.getAllByText('Nouveau');
    const doublons = screen.getAllByText('Doublon');
    // "Doublon" appears once as row label and once as status tag — filter labels out
    expect(nouveaux).toHaveLength(2);
    // Two Doublon literals: the label of the deduped row + the state tag.
    expect(doublons.length).toBeGreaterThanOrEqual(2);
  });

  it('fires onConfirm when Importer is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when Annuler is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} pending />);
    expect(screen.getByRole('button', { name: /Import…|Importer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
  });

  it('collapses rows past 100 behind a "voir tout" toggle', async () => {
    const many: ImportPreview = {
      ...preview,
      totalRows: 150,
      newRows: Array.from({ length: 150 }, (_, i) => ({
        date: '2026-06-15', amount: '-1.00', rawLabel: `Row-${i}`, memo: null,
      })),
      duplicateRows: [],
    };
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={many} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Row-0')).toBeInTheDocument();
    expect(screen.getByText('Row-99')).toBeInTheDocument();
    expect(screen.queryByText('Row-100')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /voir tout/ }));
    expect(screen.getByText('Row-149')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd frontend && npm test -- ImportPreviewModal
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/Imports/ImportPreviewModal.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { ImportPreview, ImportPreviewRow } from '../../api/imports';

const COLLAPSE_LIMIT = 100;

type Tagged = ImportPreviewRow & { status: 'Nouveau' | 'Doublon' };

function formatAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportPreviewModal({
  preview,
  onConfirm,
  onCancel,
  pending,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const rows: Tagged[] = useMemo(() => {
    const n: Tagged[] = preview.newRows.map((r) => ({ ...r, status: 'Nouveau' as const }));
    const d: Tagged[] = preview.duplicateRows.map((r) => ({ ...r, status: 'Doublon' as const }));
    return [...n, ...d];
  }, [preview.newRows, preview.duplicateRows]);

  const shown = expanded ? rows : rows.slice(0, COLLAPSE_LIMIT);
  const hidden = rows.length - shown.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Prévisualiser l'import"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="surface w-full max-w-3xl max-h-[90vh] flex flex-col p-5 md:p-6">
        <div className="mb-4">
          <div className="font-mono text-sm text-ink-100 truncate">{preview.filename}</div>
          <div className="mt-2 text-sm text-ink-300">
            <span className="font-mono text-sage-300">{preview.newRows.length}</span> nouvelle
            {preview.newRows.length > 1 ? 's' : ''} ·{' '}
            <span className="font-mono text-ink-400">{preview.duplicateRows.length}</span>{' '}
            dédupliquée{preview.duplicateRows.length > 1 ? 's' : ''}{' '}
            <span className="text-ink-500">sur {preview.totalRows}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto border border-ink-800/60 rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-ink-500 bg-ink-900/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Libellé</th>
                <th className="text-right px-3 py-2">Montant</th>
                <th className="text-left px-3 py-2">État</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={`${r.date}-${r.rawLabel}-${i}`}
                  className={r.status === 'Doublon' ? 'text-ink-500' : 'text-ink-200'}
                >
                  <td className="px-3 py-1.5 font-mono">{r.date}</td>
                  <td className="px-3 py-1.5">{r.rawLabel}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatAmount(r.amount)}</td>
                  <td className="px-3 py-1.5">
                    <span className={r.status === 'Nouveau' ? 'text-sage-300' : 'text-ink-500'}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 text-[11px] text-ink-500 hover:text-ink-100 transition self-start"
          >
            voir tout ({hidden} de plus)
          </button>
        )}

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            className="text-sm text-ink-400 hover:text-ink-100 transition disabled:opacity-40"
            onClick={onCancel}
            disabled={pending}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Import…' : 'Importer'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd frontend && npm test -- ImportPreviewModal
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Imports/ImportPreviewModal.tsx \
  frontend/src/pages/Imports/__tests__/ImportPreviewModal.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(frontend): add ImportPreviewModal for OFX/CSV dry-run confirmation

Displays parsed rows split into "Nouveau" and "Doublon" with a per-row
status tag, a header line summarising counts vs total, and Importer /
Annuler buttons. Rows past 100 collapse behind a "voir tout" toggle so
large statements stay responsive.
EOF
)"
```

---

### Task 4: Frontend — wire preview modal into `UploadForm`'s OFX/CSV single-file path

**Files:**
- Create: `frontend/src/pages/Imports/useImportPreview.ts` (extracted hook — owns preview state and confirm/cancel; keeps `UploadForm.tsx` under 300 lines)
- Create: `frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx` (hook unit tests)
- Modify: `frontend/src/pages/Imports/UploadForm.tsx` (single-file OFX/CSV branch in `submit`, around lines 122–142; call the hook, render the modal)
- Modify: `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx` (add integration tests for the preview flow)

**Interfaces:**
- Consumes: `previewImport` from `../../api/imports` (Task 2), `ImportPreviewModal` from `./ImportPreviewModal` (Task 3), the existing `apiUpload` used by the confirm step.
- Produces: `useImportPreview({ onImported, invalidate })` hook returning `{ preview, pending, start(file, accountId?), confirm(), cancel() }`. `UploadForm`'s public prop signature is unchanged — this is an internal refactor.

- [ ] **Step 1: Add the failing preview tests**

Append these tests to `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx` inside the existing `describe('UploadForm', () => { … })` block:

```tsx
  it('CSV single-file submit opens the preview modal instead of importing directly', async () => {
    const { previewImport } = await import('../../../api/imports');
    // Mock the preview helper. It's imported statically at the top of the test file,
    // so mock it via vi.mock at the top level (see step 2).
    (previewImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'p.csv', format: 'csv', accountId: 1, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'p.csv', { type: 'text/csv' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));
    // Modal is open, actual import hasn't fired yet.
    expect(screen.getByRole('dialog', { name: /Prévisualiser/ })).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('clicking Importer inside the preview modal fires apiUpload with the same file', async () => {
    const { previewImport } = await import('../../../api/imports');
    (previewImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'p.csv', format: 'csv', accountId: 1, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    uploadMock.mockResolvedValue({ filename: 'p.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'p.csv', { type: 'text/csv' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await screen.findByRole('dialog', { name: /Prévisualiser/ });
    // Second "Importer" — the one inside the modal.
    const modalConfirm = screen.getAllByRole('button', { name: /Importer|Import…/ })
      .find((b) => b.closest('[role="dialog"]'));
    await user.click(modalConfirm!);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith('/api/imports', expect.any(File), { query: { accountId: 1 } }));
    await waitFor(() => expect(props.onOfxCsvSuccess).toHaveBeenCalled());
  });

  it('clicking Annuler in the preview modal closes it and does not call apiUpload', async () => {
    const { previewImport } = await import('../../../api/imports');
    (previewImport as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'p.csv', format: 'csv', accountId: 1, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'p.csv', { type: 'text/csv' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await screen.findByRole('dialog', { name: /Prévisualiser/ });
    const modalCancel = screen.getAllByRole('button', { name: 'Annuler' })
      .find((b) => b.closest('[role="dialog"]'));
    await user.click(modalCancel!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Prévisualiser/ })).not.toBeInTheDocument());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('PDF single-file submit skips the preview modal (goes straight to submitPdf)', async () => {
    const { previewImport } = await import('../../../api/imports');
    submitPdfMock.mockResolvedValue({
      kind: 'imported',
      result: { fileImportId: 1, filename: 'x.pdf', insertedCount: 1, dedupSkipped: 0, totalLines: 1 },
    } as any);
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'x.pdf', { type: 'application/pdf' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(submitPdfMock).toHaveBeenCalledTimes(1));
    expect(previewImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Prévisualiser/ })).not.toBeInTheDocument();
  });

  it('multi-file batch skips the preview modal (imports directly)', async () => {
    const { previewImport } = await import('../../../api/imports');
    uploadMock.mockResolvedValue({ filename: 'a.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, [
      new File(['x'], 'a.csv', { type: 'text/csv' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Importer 2 fichiers/ }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(previewImport).not.toHaveBeenCalled();
  });
```

Also add the `vi.mock` for `../../api/imports` at the top of the test file, near the existing `vi.mock('../../../api/client', …)`:

```tsx
vi.mock('../../../api/imports', () => ({
  previewImport: vi.fn(),
}));
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd frontend && npm test -- UploadForm
```

Expected: the five new tests FAIL — `previewImport` isn't called yet by `UploadForm`; the modal never opens.

- [ ] **Step 3: Extract the `useImportPreview` hook**

Create `frontend/src/pages/Imports/useImportPreview.ts`:

```tsx
import { useState } from 'react';
import { previewImport, type ImportPreview } from '../../api/imports';
import { apiUpload, ApiError } from '../../api/client';

interface OfxCsvSuccess {
  filename: string;
  inserted: number;
  skipped: number;
  total: number;
}

export function useImportPreview(opts: {
  onImported: (result: OfxCsvSuccess) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  invalidate: () => void;
}) {
  const [state, setState] = useState<{
    file: File;
    data: ImportPreview;
    confirming: boolean;
  } | null>(null);

  const start = async (file: File, accountId?: number) => {
    try {
      const data = await previewImport(file, accountId);
      setState({ file, data, confirming: false });
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : 'Erreur lors de la prévisualisation.');
    }
  };

  const confirm = async () => {
    if (!state) return;
    setState({ ...state, confirming: true });
    try {
      const data = await apiUpload<{
        filename: string; insertedCount: number; dedupSkipped: number; totalLines: number;
      }>('/api/imports', state.file, {
        query: state.data.accountId ? { accountId: state.data.accountId } : undefined,
      });
      opts.onImported({
        filename: state.file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        total: data.totalLines,
      });
      opts.invalidate();
      setState(null);
      opts.onSuccess();
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : 'Erreur lors de l\'import.');
      setState(null);
    }
  };

  const cancel = () => setState(null);

  return { preview: state?.data ?? null, pending: state?.confirming ?? false, start, confirm, cancel };
}
```

Create the hook unit test `frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useImportPreview } from '../useImportPreview';

vi.mock('../../../api/imports', () => ({ previewImport: vi.fn() }));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, apiUpload: vi.fn() };
});
import { previewImport } from '../../../api/imports';
import { apiUpload } from '../../../api/client';
const previewMock = vi.mocked(previewImport);
const uploadMock = vi.mocked(apiUpload);

beforeEach(() => { previewMock.mockReset(); uploadMock.mockReset(); });

const cbs = () => ({ onImported: vi.fn(), onError: vi.fn(), onSuccess: vi.fn(), invalidate: vi.fn() });

describe('useImportPreview', () => {
  it('start() populates preview state with the returned ImportPreview', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(result.current.preview?.filename).toBe('x.csv');
    expect(c.onError).not.toHaveBeenCalled();
  });

  it('confirm() calls apiUpload with the retained file and invokes onImported', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 1, newRows: [], duplicateRows: [],
    });
    uploadMock.mockResolvedValue({ filename: 'x.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm(); });
    expect(uploadMock).toHaveBeenCalledWith('/api/imports', file, { query: { accountId: 3 } });
    expect(c.onImported).toHaveBeenCalledWith({ filename: 'x.csv', inserted: 1, skipped: 0, total: 1 });
    expect(c.invalidate).toHaveBeenCalled();
    expect(c.onSuccess).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it('cancel() clears preview state without calling apiUpload', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 0, newRows: [], duplicateRows: [],
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    act(() => { result.current.cancel(); });
    expect(result.current.preview).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('preview error surfaces via onError and leaves preview null', async () => {
    previewMock.mockRejectedValue(new Error('boom'));
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(c.onError).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });
});
```

Run the hook tests: `cd frontend && npm test -- useImportPreview` — expected PASS (4 tests).

- [ ] **Step 4: Wire the hook into `UploadForm.tsx`**

Modify `frontend/src/pages/Imports/UploadForm.tsx`:

**A. Add imports at the top of the file:**

```tsx
import { useImportPreview } from './useImportPreview';
import { ImportPreviewModal } from './ImportPreviewModal';
```

**B. Call the hook inside the component body, near the other `useState`s:**

```tsx
const previewCtl = useImportPreview({
  onImported: (r) => onOfxCsvSuccess(r),
  onError: (msg) => setError(msg),
  onSuccess: () => {
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
  },
  invalidate: invalidateAll,
});
```

**C. Replace the OFX/CSV single-file branch in `submit` (currently lines 122–142) with:**

```tsx
      // OFX / CSV single-file — dry-run first, then confirm through the modal.
      await previewCtl.start(f, accountId ? (accountId as number) : undefined);
      return;
```

**D. Render the modal after the existing `{error && …}` block, before the closing `</>`:**

```tsx
{previewCtl.preview && (
  <ImportPreviewModal
    preview={previewCtl.preview}
    onConfirm={previewCtl.confirm}
    onCancel={previewCtl.cancel}
    pending={previewCtl.pending}
  />
)}
```

- [ ] **Step 4b: Verify UploadForm.tsx line count**

```bash
wc -l frontend/src/pages/Imports/UploadForm.tsx
```

Expected: fewer than 300 lines. If it's still over, move the "batch loop" body (currently lines 148–195 of the original file) into a local helper function inside `UploadForm` — the extraction that trims the most is done in Task 6, so a slight overshoot here is acceptable if the trend is clearly downward.

- [ ] **Step 5: Run all UploadForm tests to verify they pass**

```bash
cd frontend && npm test -- UploadForm
```

Expected: PASS — all existing tests plus the five new ones. If an old test breaks because it expected the OFX/CSV single-file path to fire `apiUpload` synchronously (without the preview modal), update it: it must now go through the modal (see the new test at Step 1 for the exact interaction).

- [ ] **Step 6: Type-check frontend**

```bash
cd frontend && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Imports/useImportPreview.ts \
  frontend/src/pages/Imports/__tests__/useImportPreview.test.tsx \
  frontend/src/pages/Imports/UploadForm.tsx \
  frontend/src/pages/Imports/__tests__/UploadForm.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(imports): preview OFX/CSV single-file uploads before committing

Single-file OFX/CSV submits now dry-run through /api/imports/preview
and open ImportPreviewModal; the actual /api/imports call fires only
when the user confirms with "Importer". PDFs, photos, and multi-file
batches keep today's direct-upload path unchanged.
EOF
)"
```

---

### Task 5: Frontend — drag-and-drop zone in `UploadForm`

**Files:**
- Create: `frontend/src/pages/Imports/drop-utils.ts` (folder-recursing `collectDroppedFiles(dataTransfer)` helper — kept out of the component so `UploadForm.tsx` stays lean)
- Create: `frontend/src/pages/Imports/__tests__/drop-utils.test.ts`
- Modify: `frontend/src/pages/Imports/UploadForm.tsx` (wrap the file-column with a drop target; wire the helper)
- Modify: `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx` (drag-and-drop integration tests)

**Interfaces:**
- Consumes: existing `pickFiles(list: FileList | null)` helper inside `UploadForm` (line 40); new `collectDroppedFiles`.
- Produces: `collectDroppedFiles(dt: DataTransfer): Promise<File[]>` — reusable helper, no framework dependency.

- [ ] **Step 1: Add the failing tests**

Append inside the same `describe('UploadForm', () => { … })` block in `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx`:

```tsx
  it('accepts files dropped onto the drop zone', async () => {
    renderForm();
    const zone = screen.getByTestId('upload-drop-zone');
    const file = new File(['x'], 'dropped.csv', { type: 'text/csv' });

    // Fire a synthetic drop with a mock DataTransfer.
    const dt = {
      files: [file] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: ['Files'],
    } as unknown as DataTransfer;
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));

    // After a microtask the summary line for a single file appears in text
    // (the file input itself doesn't reflect `files` after synthetic drop, so
    // we assert via the submit button label switching).
    await waitFor(() => {
      // With 1 file the button says "Importer" (existing behavior); to prove
      // the state actually populated we assert the batch summary line for >1
      // is absent AND the submit button is enabled.
      const btn = screen.getByRole('button', { name: /^Importer/ });
      expect(btn).not.toBeDisabled();
    });
  });

  it('filters out unsupported extensions from a drop', async () => {
    renderForm();
    const zone = screen.getByTestId('upload-drop-zone');
    const junk = new File(['x'], '.DS_Store', { type: '' });
    const good = new File(['x'], 'ok.csv', { type: 'text/csv' });
    const dt = {
      files: [junk, good] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: ['Files'],
    } as unknown as DataTransfer;
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    await waitFor(() => {
      // Only one accepted file → no batch summary, submit button says "Importer".
      const btn = screen.getByRole('button', { name: /^Importer$/ });
      expect(btn).not.toBeDisabled();
    });
    // No "2 fichiers sélectionnés" summary since junk was dropped.
    expect(screen.queryByText(/2 fichiers sélectionnés/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd frontend && npm test -- UploadForm
```

Expected: the two new tests FAIL — no `upload-drop-zone` testid exists yet.

- [ ] **Step 3: Create the folder-walker helper**

Create `frontend/src/pages/Imports/drop-utils.ts`:

```ts
// Recursively collects all File objects from a drag-and-drop DataTransfer,
// walking into any subdirectories via the webkit entry API. Files that never
// resolve (e.g. permissions errors) are silently dropped — the caller sees
// only what it can actually read.
export async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const items = dt.items;
  const hasItemsApi = items && items.length > 0 &&
    typeof (items[0] as any)?.webkitGetAsEntry === 'function';

  if (hasItemsApi) {
    const walk = async (entry: any): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file(
            (file: File) => { collected.push(file); resolve(); },
            () => resolve(),
          );
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        await new Promise<void>((resolve) => {
          const readBatch = () => {
            reader.readEntries(
              async (entries: any[]) => {
                if (entries.length === 0) return resolve();
                for (const child of entries) await walk(child);
                readBatch();
              },
              () => resolve(),
            );
          };
          readBatch();
        });
      }
    };
    for (let i = 0; i < items.length; i++) {
      await walk((items[i] as any).webkitGetAsEntry?.());
    }
  }

  if (collected.length === 0 && dt.files && dt.files.length > 0) {
    collected.push(...Array.from(dt.files));
  }
  return collected;
}
```

Create `frontend/src/pages/Imports/__tests__/drop-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectDroppedFiles } from '../drop-utils';

function fakeDataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['Files'],
  } as unknown as DataTransfer;
}

describe('collectDroppedFiles', () => {
  it('falls back to dt.files when webkitGetAsEntry is unavailable', async () => {
    const a = new File(['x'], 'a.csv', { type: 'text/csv' });
    const b = new File(['x'], 'b.csv', { type: 'text/csv' });
    const result = await collectDroppedFiles(fakeDataTransfer([a, b]));
    expect(result.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
  });

  it('returns [] for an empty DataTransfer', async () => {
    const result = await collectDroppedFiles(fakeDataTransfer([]));
    expect(result).toEqual([]);
  });
});
```

Run: `cd frontend && npm test -- drop-utils` — expected PASS (2 tests).

- [ ] **Step 4: Add the drop zone to `UploadForm.tsx`**

Modify `frontend/src/pages/Imports/UploadForm.tsx`:

**A. Add the import at the top of the file:**

```tsx
import { collectDroppedFiles } from './drop-utils';
```

**B. Add drop state and handler near the other hooks (below the existing `useState` calls):**

```tsx
const [dragOver, setDragOver] = useState(false);

const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.stopPropagation();
  setDragOver(false);
  if (pending) return;
  const collected = await collectDroppedFiles(e.dataTransfer);
  const kept = collected.filter((f) => acceptFile(f.name));
  setFiles(kept);
  setError(null);
  onFileSelected();
};
```

**C. Wrap the "Fichier(s)" column in the JSX. Locate the outer `<div className="flex flex-col gap-1.5 flex-1 min-w-0">` around line 201 and change it to:**

```tsx
<div
  data-testid="upload-drop-zone"
  onDrop={onDrop}
  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
  onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
  onDragLeave={() => setDragOver(false)}
  className={`flex flex-col gap-1.5 flex-1 min-w-0 rounded-lg border-2 border-dashed p-3 transition ${
    dragOver ? 'border-sage-400 bg-sage-900/10' : 'border-ink-800/60'
  }`}
>
  <label className="label">
    Fichier(s) — .ofx · .qfx · .csv · .pdf
    <span className="ml-2 text-[10px] font-normal text-ink-500">
      Glissez un fichier ici ou <span className="underline">parcourir</span>
    </span>
  </label>
  {/* the existing <input ref={fileRef} …>, hidden folder input, and helper
      links stay unchanged here */}
```

Keep everything inside that wrapper `<div>` as it is today (the file input, the hidden folder input, the "ou choisir un dossier" link, the "N fichiers sélectionnés" span). Close the wrapper `</div>` where the original column closed.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npm test -- UploadForm drop-utils
```

Expected: PASS — all previous + preview tests + the two drop tests + the drop-utils tests.

- [ ] **Step 6: Verify UploadForm.tsx line count**

```bash
wc -l frontend/src/pages/Imports/UploadForm.tsx
```

Expected: fewer than 300 lines. Task 6's extraction is the largest, so this task can end within a few lines of 300 if the trend is downward — but do not exceed 300 by this task's commit.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Imports/drop-utils.ts \
  frontend/src/pages/Imports/__tests__/drop-utils.test.ts \
  frontend/src/pages/Imports/UploadForm.tsx \
  frontend/src/pages/Imports/__tests__/UploadForm.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(imports): drag-and-drop zone around the file picker

Wraps the "Fichier(s)" column in a dashed drop target that accepts
files and folders. Folder drops recurse via webkitGetAsEntry (same as
the existing "ou choisir un dossier" folder-pick button). Unsupported
extensions (e.g. .DS_Store) are filtered out with the existing
acceptFile predicate. The file input, folder-pick link, and photo
input keep their current behavior.
EOF
)"
```

---

### Task 6: Frontend — retry failed items on the batch summary panel + wizard-resolved callback

**Files:**
- Create: `frontend/src/pages/Imports/BatchSummaryPanel.tsx` (extracted panel — renders the running-progress line, done-summary, error list with Réessayer buttons; keeps `UploadForm.tsx` under 300 lines)
- Create: `frontend/src/pages/Imports/__tests__/BatchSummaryPanel.test.tsx`
- Modify: `frontend/src/pages/Imports/UploadForm.tsx` (change `errors` shape to retain `File`; delegate rendering to `BatchSummaryPanel`; add retry helpers)
- Modify: `frontend/src/pages/Data/Imports.tsx` (wire the wizard-resolved callback so cancel/finalize propagate back to `UploadForm`)
- Modify: `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx` (retry integration tests)

**Interfaces:**
- Consumes: existing `apiUpload`, `submitPdf` (from `../../api/pdf-templates`), the parent's `onPdfNeedsTemplate` callback (now takes an optional second arg — see below).
- Produces: `UploadForm` gains a new callback prop signature detail — `onPdfNeedsTemplate` becomes `(p: PdfImportNeedsTemplate, ctx?: { resolve: (success: boolean) => void }) => void`. Parents that don't pass `ctx.resolve` still work; `Imports.tsx` is updated in this task to use it.

- [ ] **Step 1: Add the failing retry tests**

Append inside the same `describe('UploadForm', () => { … })` block in `frontend/src/pages/Imports/__tests__/UploadForm.test.tsx`:

```tsx
  it('retry from the batch summary re-runs apiUpload for a failed CSV and removes the error row on success', async () => {
    // First submit: two files, second one fails.
    uploadMock.mockImplementationOnce(async () => ({ filename: 'a.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 }));
    uploadMock.mockImplementationOnce(async () => { throw new Error('boom'); });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, [
      new File(['x'], 'a.csv', { type: 'text/csv' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Importer 2 fichiers/ }));

    // Batch-done summary shows 1 error.
    await waitFor(() => expect(screen.getByText(/1 en erreur/)).toBeInTheDocument());
    await user.click(screen.getByText(/1 en erreur/)); // open details

    // Retry succeeds this time.
    uploadMock.mockResolvedValueOnce({ filename: 'b.csv', insertedCount: 3, dedupSkipped: 0, totalLines: 3 });
    await user.click(screen.getByRole('button', { name: /Réessayer/ }));

    await waitFor(() => expect(screen.queryByText(/1 en erreur/)).not.toBeInTheDocument());
    // Counts updated: 1 (from a.csv) + 3 (retried b.csv) = 4 inserted.
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });

  it('retry that fails again updates the error message in place', async () => {
    uploadMock.mockImplementationOnce(async () => ({ filename: 'a.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 }));
    uploadMock.mockImplementationOnce(async () => { throw new Error('first'); });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, [
      new File(['x'], 'a.csv', { type: 'text/csv' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Importer 2 fichiers/ }));
    await waitFor(() => expect(screen.getByText(/1 en erreur/)).toBeInTheDocument());
    await user.click(screen.getByText(/1 en erreur/));

    uploadMock.mockRejectedValueOnce(new Error('second'));
    await user.click(screen.getByRole('button', { name: /Réessayer/ }));

    await waitFor(() => expect(screen.getByText(/second/)).toBeInTheDocument());
    // Still 1 error, not 2.
    expect(screen.getAllByText(/1 en erreur/)).toHaveLength(1);
  });

  it('"Réessayer tout" retries every failed file', async () => {
    uploadMock.mockRejectedValueOnce(new Error('e1'));
    uploadMock.mockRejectedValueOnce(new Error('e2'));
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, [
      new File(['x'], 'a.csv', { type: 'text/csv' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Importer 2 fichiers/ }));
    await waitFor(() => expect(screen.getByText(/2 en erreur/)).toBeInTheDocument());
    await user.click(screen.getByText(/2 en erreur/));

    uploadMock.mockResolvedValueOnce({ filename: 'a.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    uploadMock.mockResolvedValueOnce({ filename: 'b.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    await user.click(screen.getByRole('button', { name: /Réessayer tout/ }));

    await waitFor(() => expect(screen.queryByText(/en erreur/)).not.toBeInTheDocument());
  });
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd frontend && npm test -- UploadForm
```

Expected: the three new tests FAIL — no retry button exists yet.

- [ ] **Step 3: Change the `errors` state shape and add retry handlers in `UploadForm.tsx`**

**A. Change the `batch` state's `errors` type** (currently around lines 29–33). Since Step F will replace this with an import from `BatchSummaryPanel`, the immediate change here is temporary — just to make the batch-loop typecheck while you write the rest of the file. The final shape lands in Step F:

```tsx
// TEMPORARY (replaced in Step F with `import { type BatchState } from './BatchSummaryPanel'`)
const [batch, setBatch] = useState<
  | { phase: 'running'; current: number; total: number; currentName: string }
  | {
      phase: 'done';
      imported: number;
      inserted: number;
      skipped: number;
      needsTemplate: string[];
      errors: { file: File; message: string }[];
    }
  | null
>(null);
```

**B. Update the batch loop's `errors.push`** (currently around lines 182–187) to push the `File`, not the name:

```tsx
} catch (err) {
  errors.push({
    file: f,
    message: err instanceof Error ? err.message : String(err),
  });
}
```

**C. Where the loop's local `errors` array is declared** (currently line 154), change the type:

```tsx
const errors: { file: File; message: string }[] = [];
```

**D. Add a retry helper above `return (`:**

```tsx
const runOne = async (f: File): Promise<
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; message: string }
> => {
  try {
    if (f.name.toLowerCase().endsWith('.pdf')) {
      if (accountId === '') return { ok: false, message: 'Compte requis pour un PDF.' };
      const r = await submitPdf(f, accountId as number);
      if (r.kind === 'imported') {
        return { ok: true, inserted: r.result.insertedCount, skipped: r.result.dedupSkipped };
      }
      // needs_template: hand off to the parent wizard; UploadForm treats this
      // as "retry in flight" until the parent's onPdfWizardResolved callback
      // reports back.
      return await new Promise((resolve) => {
        onPdfNeedsTemplate(r, {
          resolve: (success) => {
            if (success) resolve({ ok: true, inserted: 0, skipped: 0 });
            else resolve({ ok: false, message: 'Template annulé.' });
          },
        });
      });
    }
    const data = await apiUpload<{
      filename: string; insertedCount: number; dedupSkipped: number; totalLines: number;
    }>('/api/imports', f, { query: accountId ? { accountId } : undefined });
    return { ok: true, inserted: data.insertedCount, skipped: data.dedupSkipped };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
};

const retryOne = async (index: number) => {
  if (!batch || batch.phase !== 'done') return;
  const target = batch.errors[index];
  if (!target) return;
  const result = await runOne(target.file);
  setBatch((prev) => {
    if (!prev || prev.phase !== 'done') return prev;
    const errors = prev.errors.slice();
    if (result.ok) {
      errors.splice(index, 1);
      invalidateAll();
      return {
        ...prev,
        errors,
        imported: prev.imported + 1,
        inserted: prev.inserted + result.inserted,
        skipped: prev.skipped + result.skipped,
      };
    }
    errors[index] = { file: target.file, message: result.message };
    return { ...prev, errors };
  });
};

const retryAll = async () => {
  if (!batch || batch.phase !== 'done') return;
  // Snapshot: retries mutate batch.errors as they complete.
  const targets = batch.errors.map((e, i) => ({ index: i, file: e.file }));
  for (const t of targets) {
    // recompute index each pass — earlier successes shrink the array.
    const cur = (batch.errors as { file: File; message: string }[])
      .findIndex((e) => e.file === t.file);
    if (cur >= 0) await retryOne(cur);
  }
};
```

**E. Update the `onPdfNeedsTemplate` prop type** at the top of the component signature:

```tsx
onPdfNeedsTemplate: (
  payload: PdfImportNeedsTemplate,
  ctx?: { resolve: (success: boolean) => void },
) => void;
```

**F. Extract the batch summary panel to its own component.**

Create `frontend/src/pages/Imports/BatchSummaryPanel.tsx`:

```tsx
export type BatchState =
  | { phase: 'running'; current: number; total: number; currentName: string }
  | {
      phase: 'done';
      imported: number;
      inserted: number;
      skipped: number;
      needsTemplate: string[];
      errors: { file: File; message: string }[];
    };

export function BatchSummaryPanel({
  batch,
  onRetryOne,
  onRetryAll,
  onClose,
}: {
  batch: BatchState;
  onRetryOne: (index: number) => void;
  onRetryAll: () => void;
  onClose: () => void;
}): JSX.Element {
  if (batch.phase === 'running') {
    if (batch.total <= 1) return <></>;
    return (
      <div className="rounded-lg border border-ink-800/60 bg-ink-900/50 px-4 py-3 text-sm text-ink-200">
        Traitement… <span className="font-mono">{batch.current} / {batch.total}</span>{' '}
        <span className="text-ink-500">— {batch.currentName}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-3 text-sm text-ink-100 space-y-1">
      <div>
        <span className="font-mono">{batch.imported}</span> fichier{batch.imported > 1 ? 's' : ''} importé{batch.imported > 1 ? 's' : ''} ·{' '}
        <span className="font-mono">{batch.inserted}</span> insérée{batch.inserted > 1 ? 's' : ''} ·{' '}
        <span className="font-mono">{batch.skipped}</span> dédupliquée{batch.skipped > 1 ? 's' : ''}
      </div>
      {batch.needsTemplate.length > 0 && (
        <div className="text-amber-300/90 text-xs">
          {batch.needsTemplate.length} PDF nécessite{batch.needsTemplate.length > 1 ? 'nt' : ''} un template — importez-les individuellement&nbsp;: {batch.needsTemplate.join(', ')}
        </div>
      )}
      {batch.errors.length > 0 && (
        <details className="text-clay-300 text-xs">
          <summary className="cursor-pointer">
            {batch.errors.length} en erreur
          </summary>
          <ul className="mt-1 space-y-1 pl-2">
            {batch.errors.map((e, i) => (
              <li key={`${e.file.name}-${i}`} className="font-mono flex items-center gap-2">
                <button
                  type="button"
                  className="text-ink-400 hover:text-ink-100 transition"
                  onClick={() => onRetryOne(i)}
                  aria-label={`Réessayer ${e.file.name}`}
                >
                  Réessayer
                </button>
                <span>{e.file.name}: {e.message}</span>
              </li>
            ))}
          </ul>
          {batch.errors.length > 1 && (
            <button
              type="button"
              className="mt-2 text-[11px] text-ink-500 hover:text-ink-100 transition"
              onClick={onRetryAll}
            >
              Réessayer tout
            </button>
          )}
        </details>
      )}
      <button
        type="button"
        className="text-[11px] text-ink-500 hover:text-ink-100 transition"
        onClick={onClose}
      >
        Fermer
      </button>
    </div>
  );
}
```

Create the component's test file `frontend/src/pages/Imports/__tests__/BatchSummaryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchSummaryPanel, type BatchState } from '../BatchSummaryPanel';

const doneWithErrors: BatchState = {
  phase: 'done', imported: 1, inserted: 3, skipped: 0, needsTemplate: [],
  errors: [
    { file: new File(['x'], 'a.csv'), message: 'boom' },
    { file: new File(['x'], 'b.csv'), message: 'kaboom' },
  ],
};

describe('BatchSummaryPanel', () => {
  it('renders "N en erreur" and one Réessayer button per error', async () => {
    const user = userEvent.setup();
    const onRetryOne = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={onRetryOne} onRetryAll={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText(/2 en erreur/));
    expect(screen.getAllByRole('button', { name: /Réessayer a\.csv|Réessayer b\.csv/ })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: /Réessayer a\.csv|Réessayer b\.csv/ })[0]!);
    expect(onRetryOne).toHaveBeenCalledWith(0);
  });

  it('shows "Réessayer tout" only when 2+ errors and calls onRetryAll', async () => {
    const user = userEvent.setup();
    const onRetryAll = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={vi.fn()} onRetryAll={onRetryAll} onClose={vi.fn()} />);
    await user.click(screen.getByText(/2 en erreur/));
    await user.click(screen.getByRole('button', { name: 'Réessayer tout' }));
    expect(onRetryAll).toHaveBeenCalledTimes(1);
  });

  it('does NOT show "Réessayer tout" when exactly one error remains', async () => {
    const user = userEvent.setup();
    const oneError: BatchState = {
      ...doneWithErrors,
      errors: [{ file: new File(['x'], 'a.csv'), message: 'boom' }],
    };
    render(<BatchSummaryPanel batch={oneError} onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText(/1 en erreur/));
    expect(screen.queryByRole('button', { name: 'Réessayer tout' })).not.toBeInTheDocument();
  });

  it('renders nothing for a single-file running phase', () => {
    render(<BatchSummaryPanel
      batch={{ phase: 'running', current: 1, total: 1, currentName: 'x.csv' }}
      onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()}
    />);
    expect(screen.queryByText(/Traitement/)).not.toBeInTheDocument();
  });

  it('renders running progress for a batch of 2+', () => {
    render(<BatchSummaryPanel
      batch={{ phase: 'running', current: 1, total: 3, currentName: 'x.csv' }}
      onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()}
    />);
    expect(screen.getByText(/Traitement/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  });

  it('Fermer calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Run: `cd frontend && npm test -- BatchSummaryPanel` — expected PASS (6 tests).

**G. Replace both the running-phase JSX (currently lines 279–284) AND the done-phase JSX (lines 286–320) inside `UploadForm.tsx` with a single call:**

```tsx
{batch && (
  <BatchSummaryPanel
    batch={batch}
    onRetryOne={retryOne}
    onRetryAll={retryAll}
    onClose={() => setBatch(null)}
  />
)}
```

Add the import at the top:

```tsx
import { BatchSummaryPanel } from './BatchSummaryPanel';
```

Also delete the `BatchState` type inlined in the `useState` generic (Step 3-A) and instead import it: since the state shape now lives in `BatchSummaryPanel.tsx`, use it as the single source of truth:

```tsx
import { BatchSummaryPanel, type BatchState } from './BatchSummaryPanel';

const [batch, setBatch] = useState<BatchState | null>(null);
```

- [ ] **Step 4: Update `Imports.tsx` to pass the wizard-resolved callback**

Modify `frontend/src/pages/Data/Imports.tsx`:

**A. Add a ref that holds the pending resolver:**

```tsx
import { useRef, useState } from 'react';
// … existing imports

// Inside `Imports()`:
const wizardResolverRef = useRef<((success: boolean) => void) | null>(null);
```

**B. Update the `onPdfNeedsTemplate` handler on `<UploadForm …>`:**

```tsx
onPdfNeedsTemplate={(p, ctx) => {
  wizardResolverRef.current = ctx?.resolve ?? null;
  setNeedsTpl(p);
  setLastImported(null);
}}
```

**C. Update the wizard's `onFinalize` and `onCancel`:**

```tsx
onFinalize={(r) => {
  setNeedsTpl(null);
  setLastImported(r);
  qc.invalidateQueries({ queryKey: ['imports'] });
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['accounts'] });
  qc.invalidateQueries({ queryKey: ['reports'] });
  qc.invalidateQueries({ queryKey: ['tri-groups'] });
  qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
  wizardResolverRef.current?.(true);
  wizardResolverRef.current = null;
}}
onCancel={() => {
  setNeedsTpl(null);
  wizardResolverRef.current?.(false);
  wizardResolverRef.current = null;
}}
```

- [ ] **Step 5: Run all frontend tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS across the whole suite. Any existing UploadForm test that referenced `errors` items by string name (e.g. `errors.find(e => e === 'x.csv')`) needs updating to the `{ file, message }` shape — sweep for such assertions and fix them if they show up in the failure list.

- [ ] **Step 6: Verify every touched file is under 300 lines**

```bash
wc -l \
  frontend/src/pages/Imports/UploadForm.tsx \
  frontend/src/pages/Imports/BatchSummaryPanel.tsx \
  frontend/src/pages/Imports/useImportPreview.ts \
  frontend/src/pages/Imports/ImportPreviewModal.tsx \
  frontend/src/pages/Imports/drop-utils.ts \
  frontend/src/pages/Data/Imports.tsx
```

Expected: every listed file reports fewer than 300 lines. If `UploadForm.tsx` is still over 300 after this task's extractions, find the next-largest self-contained block (usually the batch loop's for-body) and move it into a local helper function file `frontend/src/pages/Imports/run-batch.ts` before committing.

- [ ] **Step 7: Type-check frontend**

```bash
cd frontend && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Imports/BatchSummaryPanel.tsx \
  frontend/src/pages/Imports/__tests__/BatchSummaryPanel.test.tsx \
  frontend/src/pages/Imports/UploadForm.tsx \
  frontend/src/pages/Data/Imports.tsx \
  frontend/src/pages/Imports/__tests__/UploadForm.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(imports): retry failed items from the batch summary panel

Batch-summary errors now retain the original File object instead of
just its name, so each error row grows a "Réessayer" button (plus a
"Réessayer tout" when ≥2 errors remain). A successful retry pulls
the row out of the errors list and folds its counts into the
imported/inserted/skipped totals; a failed retry updates the message
in place.

PDF retries that come back as needs_template hand off to the existing
template wizard, and the wizard's finalize/cancel now propagate back
to UploadForm via a resolver ref on the parent (Imports.tsx) so the
error row stays / is removed based on wizard outcome.
EOF
)"
```

---

## Self-Review

Ran the checklist against the spec (`docs/superpowers/specs/2026-07-16-imports-upload-ux-design.md`):

**Spec coverage:**
- Drag-and-drop zone → **Task 5** (drop target, folder recursion via `webkitGetAsEntry`, `acceptFile` filter, form-area scope). ✓
- Preview endpoint + response shape → **Task 1** (backend service + route + tests). ✓
- Preview modal with `Nouveau`/`Doublon` split, counts, collapse past 100 → **Task 3**. ✓
- Preview wired into OFX/CSV single-file only, PDFs/photos/batch skip → **Task 4** (with tests for all four skipping paths). ✓
- Retry retains `File` objects, ↻ Réessayer per row, Réessayer tout → **Task 6**. ✓
- PDF-retry-into-wizard with success/cancel outcome propagating back → **Task 6** (Step 4 wires `wizardResolverRef` in `Imports.tsx`). ✓

**Placeholder scan:** No TBD/TODO. All code blocks are complete. All commit commands are full. All test bodies are runnable. ✓

**Type consistency:**
- `ImportPreview` / `ImportPreviewRow` types identical between backend `PreviewResult` (Task 1) and frontend `ImportPreview` (Task 2). ✓
- `onPdfNeedsTemplate` signature change is applied in both `UploadForm.tsx` (Task 6-E) and `Imports.tsx` (Task 6, Step 4-B). ✓
- `errors: { file: File; message: string }[]` used consistently across state shape (Task 6-A), loop push (Task 6-B), loop declaration (Task 6-C), retry helpers (Task 6-D), and summary render (Task 6-F). ✓
- `previewImport(file, accountId?)` signature — Task 2 defines it; Tasks 3, 4 consume it with the same optional-second-arg convention. ✓

No issues surviving review.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-16-imports-upload-ux.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
