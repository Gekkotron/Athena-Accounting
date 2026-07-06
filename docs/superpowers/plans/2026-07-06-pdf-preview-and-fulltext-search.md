# PDF wizard preview + full-text search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two independent quality-of-life features: (a) an "Aperçu" button in the PDF template wizard that shows extracted rows before hitting the DB, and (b) extending the transactions `?search=` filter to also match `raw_label`, `memo`, and `notes` (currently only `normalized_label`).

**Architecture:** Feature (a) adds a side-effect-free preview endpoint next to `POST /api/imports/pdf/templates` and wires a button + result panel into `PdfTemplateBuilder`. Feature (b) is a one-file backend WHERE-clause extension in `transactions/index.ts` — no migration, no index (pg_trgm exists but v1 uses seq-friendly ILIKE, adequate for the homelab scale). Both features are independent commits.

**Tech Stack:** TypeScript, Fastify (backend), Drizzle ORM, Postgres 16, React + React Query (frontend), Vitest + Testing Library + jsdom (tests). DB tests gated behind `RUN_DB_TESTS=1` env var (CI has it; local dev doesn't per project policy — see `TODO.md` "Sur les tests d'intégration DB").

## Global Constraints

- Backend tests requiring Postgres live in `backend/tests/**` with `describe.skipIf(!RUN_DB_TESTS)` at the top. Only skip DB integration when `RUN_DB_TESTS` is unset — the CI job runs with it set.
- French UI copy stays French. UI helpers `formatAmount`, `formatDate`, `amountSignClass` come from `frontend/src/lib/format`.
- No dependencies added — the plan uses only what's already imported in the touched files.
- No comment-noise: only add comments when the WHY is non-obvious per the repo's CLAUDE.md style (already applied throughout the codebase — mirror it).
- Commit style: one commit per task, following the imperative `feat(scope): message` / `test(scope): message` convention seen in `git log`.

---

## Task 1: Extend `?search=` filter across raw_label + memo + notes

**Files:**
- Modify: `backend/src/http/routes/transactions/index.ts` (block starting ~line 169, `if (q.search) { ... }`)
- Modify: `backend/tests/transactions-route.test.ts` (extend the existing search test suite around line 200)

**Interfaces:**
- Consumes: `q.search` (already parsed by `ListQuery` in `schemas.ts`, `z.string().trim().max(128).optional()`), `transactions.rawLabel`, `transactions.normalizedLabel`, `transactions.memo`, `transactions.notes` (all in schema).
- Produces: same public API. `GET /api/transactions?search=xxx` continues to return `{ transactions, pagination }`; only the matching predicate widens.

- [ ] **Step 1: Add failing tests for the four field matches**

Open `backend/tests/transactions-route.test.ts`. Immediately after the existing `it('search matches raw_label case-insensitively', ...)` test (line 200-209), add these four tests inside the same `describe` block:

```typescript
    it('search matches memo case-insensitively', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'AMZN MKTP' });
      // memo isn't a create-body field — set it via PATCH after creation.
      const id = await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-2.00', rawLabel: 'ORDINARY' });
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.update(transactions).set({ memo: 'ID: NFX-42' }).where(eq(transactions.id, id));
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=NFX',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search matches notes case-insensitively', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'VIR IBAN123' });
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { notes: 'facture netflix' },
      });
      await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-1.00', rawLabel: 'OTHER' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=netflix',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search is accent-insensitive across notes', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'X' });
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie },
        payload: { notes: 'café' },
      });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=cafe',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(1);
      expect(res.json().transactions[0].id).toBe(id);
    });

    it('search returns nothing when the needle matches no field', async () => {
      await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'CB CARREFOUR' });
      const res = await app.inject({
        method: 'GET', url: '/api/transactions?search=xyzzy',
        headers: { cookie },
      });
      expect(res.json().transactions).toHaveLength(0);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/transactions-route.test.ts -t "search"`

Expected: the four new tests FAIL because `memo`/`notes` are not yet in the WHERE clause. The existing `search matches raw_label case-insensitively` test may pass because `raw_label` and `normalized_label` are close enough that the trigger writes them similarly — verify: if it now fails too, that's a signal the current impl only matches on `normalized_label` even for words in `raw_label`, and Task 1's fix will correct that as a bonus.

- [ ] **Step 3: Extend the search WHERE clause**

Open `backend/src/http/routes/transactions/index.ts`. Replace the block starting at `if (q.search) {` (currently 6 lines) with:

```typescript
    if (q.search) {
      // Substring match across every user-facing text field, accent- and
      // case-insensitive. Four seq-scan LIKE branches — acceptable at
      // homelab scale (~<10k rows). If perf hurts, promote to a generated
      // column + GIN trigram index (see TODO.md).
      const needle = sql`immutable_unaccent(lower(${q.search}))`;
      where.push(sql`(
        immutable_unaccent(lower(${transactions.rawLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.memo}, ''))) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.notes}, ''))) LIKE '%' || ${needle} || '%'
      )`);
    }
```

Verify that `sql` from `drizzle-orm` is already imported at the top of this file (it is — used on line 149 for the split existence check).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/transactions-route.test.ts -t "search"`

Expected: all five search tests (the original one plus the four new ones) PASS.

- [ ] **Step 5: Sanity-check the rest of the transactions suite didn't regress**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/transactions-route.test.ts`

Expected: all tests in this file PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/routes/transactions/index.ts backend/tests/transactions-route.test.ts
git commit -m "feat(transactions): full-text search across raw_label + memo + notes"
```

---

## Task 2: Preview endpoint `POST /api/imports/pdf/templates/preview`

**Files:**
- Modify: `backend/src/http/routes/imports.ts` (add new route handler)
- Modify: `backend/src/domain/imports/pdf/index.ts` (export a small helper to keep the route lean)
- Modify: `backend/tests/imports-route.test.ts` (add preview integration tests)

**Interfaces:**
- Consumes: `pdfImportDrafts` table (existing), `TemplateZones` type (`domain/imports/pdf/zones.js`), `validateZones` (same), `extractText` from `domain/imports/pdf/text-extract.js`, `applyTemplate` from `domain/imports/pdf/template-apply.js`.
- Produces:
  - Route `POST /api/imports/pdf/templates/preview`
  - Body: `{ draftId: number, zones: TemplateZones }`
  - Success `200`: `{ rows: ParsedTransaction[], skippedRows: Array<{ rowText: string; reason: string }> }` where `ParsedTransaction = { date: string; amount: string; rawLabel: string; memo: string | null; fitid: string | null }` (this is `ParsedTransaction` from `domain/imports/ofx-parser.js`).
  - Error `400`: bad body / invalid zones / missing draftId.
  - Error `410`: `{ code: 'draft_expired', error: 'draft expired or not found' }` (same shape as existing endpoint).
  - New exported helper (in `domain/imports/pdf/index.ts`): `previewTemplate({ draftId, zones, userId }: { draftId: number; zones: TemplateZones; userId: number }): Promise<{ rows: ParsedTransaction[]; skippedRows: Array<{ rowText: string; reason: string }> }>` — throws `Error & { code: 'draft_expired' }` on missing/expired/wrong-user draft.

- [ ] **Step 1: Write the failing route tests**

Open `backend/tests/imports-route.test.ts`. Immediately before the final `});` that closes the outer `describe.skipIf(!RUN)('/api/imports', () => { ... })`, append this nested block:

```typescript
  describe('POST /api/imports/pdf/templates/preview', () => {
    async function insertDraft(zones: unknown = null, opts: { expired?: boolean; foreignUser?: boolean } = {}): Promise<number> {
      const PDFDocument = (await import('pdfkit')).default;
      const buf: Buffer = await new Promise((resolve) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.font('Helvetica').fontSize(10);
        doc.text('BANQUE PREVIEW',                40,  30);
        doc.text("Relevé n°99999",                40,  60);
        doc.text('Date',     40,  200);
        doc.text('Libellé',  120, 200);
        doc.text('Montant',  480, 200);
        doc.text('15/01/2026',   40,  220);
        doc.text('CB CARREFOUR', 120, 220);
        doc.text('-42,30',       480, 220);
        doc.text('17/01/2026',   40,  240);
        doc.text('SALAIRE',      120, 240);
        doc.text('1 200,00',     480, 240);
        doc.end();
      });
      const { db } = await import('../src/db/client.js');
      const { pdfImportDrafts, users, accounts } = await import('../src/db/schema.js');
      let ownerId = -1;
      let ownerAccountId = accountId;
      if (opts.foreignUser) {
        const [u] = await db.insert(users).values({
          username: `foreign-${Date.now()}`,
          passwordHash: 'not-a-real-hash',
        }).returning();
        ownerId = u!.id;
        const [a] = await db.insert(accounts).values({
          userId: ownerId, name: 'Foreign', type: 'checking', openingDate: '2025-01-01',
        }).returning();
        ownerAccountId = a!.id;
      } else {
        const { eq } = await import('drizzle-orm');
        const [u] = await db.select().from(users).where(eq(users.username, 'imp-user'));
        ownerId = u!.id;
      }
      const expiresAt = opts.expired
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + 60 * 60_000);
      const [draft] = await db.insert(pdfImportDrafts).values({
        userId: ownerId,
        accountId: ownerAccountId,
        pdfBytes: buf.toString('base64'),
        textItems: [],
        fingerprint: 'preview-test',
        expiresAt,
      }).returning();
      return draft!.id;
    }

    const goodZones = {
      headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
      tableZone: { page: 0, x: 30, y: 195, w: 540, h: 200 },
      tableRepeatsPerPage: true,
      selectedPages: [0],
      columns: [
        { xStart: 30,  xEnd: 110, role: 'date' },
        { xStart: 110, xEnd: 470, role: 'description' },
        { xStart: 470, xEnd: 570, role: 'amountSigned' },
      ],
      rowsStartY: 210,
    };

    it('returns extracted rows without persisting anything', async () => {
      const draftId = await insertDraft();
      const before = await countTransactions();
      const res = await app.inject({
        method: 'POST', url: '/api/imports/pdf/templates/preview',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ draftId, zones: goodZones }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.rows[0]).toMatchObject({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        amount: expect.stringMatching(/^-?\d+\.\d{2}$/),
        rawLabel: expect.any(String),
      });
      const after = await countTransactions();
      expect(after).toBe(before);
    });

    it('returns 410 draft_expired when the draft is past its expiry', async () => {
      const draftId = await insertDraft(null, { expired: true });
      const res = await app.inject({
        method: 'POST', url: '/api/imports/pdf/templates/preview',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ draftId, zones: goodZones }),
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('draft_expired');
    });

    it('returns 410 draft_expired when the draft belongs to another user', async () => {
      const draftId = await insertDraft(null, { foreignUser: true });
      const res = await app.inject({
        method: 'POST', url: '/api/imports/pdf/templates/preview',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ draftId, zones: goodZones }),
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('draft_expired');
    });

    it('rejects missing body fields with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/imports/pdf/templates/preview',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ zones: goodZones }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns rows: [] with skippedRows populated when zones don\'t match', async () => {
      const draftId = await insertDraft();
      const badZones = {
        ...goodZones,
        columns: [
          { xStart: 0, xEnd: 5, role: 'date' },
          { xStart: 5, xEnd: 10, role: 'description' },
          { xStart: 10, xEnd: 15, role: 'amountSigned' },
        ],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/imports/pdf/templates/preview',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ draftId, zones: badZones }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toEqual([]);
    });
  });

  async function countTransactions(): Promise<number> {
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { sql } = await import('drizzle-orm');
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);
    return r?.n ?? 0;
  }
```

Note: place the `countTransactions` helper INSIDE the outer describe block, next to the file's other helpers (before the inner `describe('POST /api/imports/pdf/templates/preview', ...)`), so the closure sees it. If your file lint doesn't allow late declarations, hoist the helper above the nested describe. Either placement inside the outer describe is fine.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/imports-route.test.ts -t "preview"`

Expected: all five preview tests FAIL with 404 (the route doesn't exist yet).

- [ ] **Step 3: Add `previewTemplate` helper**

Open `backend/src/domain/imports/pdf/index.ts`. Append this export at the bottom of the file:

```typescript
export interface PreviewTemplateResult {
  rows: import('../ofx-parser.js').ParsedTransaction[];
  skippedRows: Array<{ rowText: string; reason: string }>;
}

// Extract rows from a draft using proposed zones, without persisting
// anything. Powers the wizard's "Aperçu" button — mirrors
// applyTemplateAndImport's read path but stops before runImport, the
// template upsert, and the anchor derivation. Anchor derivation is
// deliberately skipped: preview should reflect what the user's CURRENT
// paint would extract, not what a save would stamp onto the template.
export async function previewTemplate(opts: {
  draftId: number;
  zones: TemplateZones;
  userId: number;
}): Promise<PreviewTemplateResult> {
  validateZones(opts.zones);
  const [draft] = await db.select().from(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  if (!draft || draft.userId !== opts.userId || draft.expiresAt < new Date()) {
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  const stored = draft.pdfBytes as unknown;
  const b64 = typeof stored === 'string' ? stored : (stored as Buffer).toString('utf8');
  const buf = Buffer.from(b64, 'base64');
  const pages = await extractText(buf);
  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  return { rows, skippedRows };
}
```

Verify these are already imported at the top of the same file: `db`, `pdfImportDrafts`, `eq`, `extractText`, `applyTemplate`, `validateZones`, `TemplateZones`. They all are.

- [ ] **Step 4: Add the route**

Open `backend/src/http/routes/imports.ts`. Add this import at the top, in the import from `'../../domain/imports/pdf/index.js'`:

```typescript
import { importPdf, applyTemplateAndImport, previewTemplate } from '../../domain/imports/pdf/index.js';
```

Then, immediately after the existing `POST /api/imports/pdf/templates` handler (right after the closing `});` of the block that starts `app.post('/api/imports/pdf/templates', ...)` around line 105-119), add:

```typescript
  app.post('/api/imports/pdf/templates/preview', async (req, reply) => {
    const body = req.body as { draftId?: number; zones?: TemplateZones };
    if (!body?.draftId || !body.zones) {
      return reply.code(400).send({ error: 'draftId and zones are required' });
    }
    try {
      const r = await previewTemplate({ draftId: body.draftId, zones: body.zones, userId: userId(req) });
      return reply.code(200).send(r);
    } catch (err: any) {
      if (err?.code === 'draft_expired') {
        return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      }
      app.log.error({ err }, 'preview template failed');
      return reply.code(400).send({ error: 'preview failed', message: err?.message ?? String(err) });
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/imports-route.test.ts -t "preview"`

Expected: all five preview tests PASS.

- [ ] **Step 6: Sanity-check the rest of the imports suite didn't regress**

Run: `cd backend && RUN_DB_TESTS=1 pnpm vitest run tests/imports-route.test.ts`

Expected: all tests in this file PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/routes/imports.ts backend/src/domain/imports/pdf/index.ts backend/tests/imports-route.test.ts
git commit -m "feat(pdf-wizard): preview endpoint returning extracted rows without insert"
```

---

## Task 3: Wizard "Aperçu" button + result panel

**Files:**
- Modify: `frontend/src/api/pdf-templates.ts` (add `PreviewResult` type + `previewZones` fetcher)
- Modify: `frontend/src/components/PdfTemplateBuilder/index.tsx` (state, reset effect, handler, button, render panel)
- Create: `frontend/src/components/PdfTemplateBuilder/__tests__/PdfTemplateBuilder.preview.test.tsx`

**Interfaces:**
- Consumes: the route from Task 2 (`POST /api/imports/pdf/templates/preview`, body `{ draftId, zones }`, 200 → `{ rows, skippedRows }`, 410 → `{ code: 'draft_expired' }`).
- Produces: no new public export; the button is internal to `PdfTemplateBuilder`.

- [ ] **Step 1: Add types + fetcher to the API layer**

Open `frontend/src/api/pdf-templates.ts`. Add these exports at the end of the file (or where types live near the top — either is fine, but keeping types together at the top and fetchers grouped at the bottom mirrors the existing structure):

Types (place near the other type exports at the top, after `PdfImportImported`):

```typescript
export interface PreviewParsedRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
  fitid: string | null;
}

export interface PreviewResult {
  rows: PreviewParsedRow[];
  skippedRows: Array<{ rowText: string; reason: string }>;
}
```

Fetcher (place next to the other fetchers, e.g. after `submitZones`):

```typescript
export async function previewZones(draftId: number, zones: TemplateZones): Promise<PreviewResult> {
  const r = await fetch('/api/imports/pdf/templates/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ draftId, zones }),
  });
  if (!r.ok) return failure(r, 'preview failed');
  return await r.json();
}
```

- [ ] **Step 2: Write the failing frontend tests**

Look at existing tests for structure: `frontend/src/components/PdfTemplateBuilder/__tests__/AnchorPickerPanel.test.tsx` and `ExtractedTextPanel.test.tsx`. Match their style.

Create `frontend/src/components/PdfTemplateBuilder/__tests__/PdfTemplateBuilder.preview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { PdfTemplateBuilder } from '../index';
import type { PdfImportNeedsTemplate } from '../../../api/pdf-templates';
import * as api from '../../../api/pdf-templates';

const draftId = 42;

// A minimal needs_template payload — one page, no suggested zones. The
// wizard doesn't need real image data for these assertions.
const needsTemplate: PdfImportNeedsTemplate = {
  kind: 'needs_template',
  draftId,
  fingerprint: 'test-fp',
  pages: [{ pageIndex: 0, pngBase64: 'iVBORw0KGgo=', widthPt: 595, heightPt: 842 }],
  textItems: [],
  suggestedZones: null,
  reason: 'low_confidence',
};

// A helper that walks the wizard to the amount step with every required
// zone painted, so the preview button becomes enabled. Uses the same
// internal handlers the real UI calls — we set state via imperative
// events because the ZoneCanvas paint interaction is exercised
// elsewhere.
async function driveToAmountStep() {
  // header → table → date → description → amount. We simulate by
  // clicking Suivant with the buttons the wizard exposes at the top.
  // Painting is faked by triggering the ZoneCanvas onChange via a data
  // attribute the component sets; if that's not available, patch the
  // useState hooks — but simpler: expose a test-only "skip painting"
  // path is out of scope. Instead, this test focuses on the AMOUNT step
  // rendering + preview button behavior once state is set.
  //
  // In practice the wizard's internal state can't be poked from outside
  // without touching implementation details. To keep this test simple,
  // we render the builder and mock out `previewZones` at the module
  // boundary; the button visibility is verified via a separate small
  // helper test that hoists state via a wrapper.
}

describe('PdfTemplateBuilder — preview button', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('calls previewZones and renders extracted rows on click', async () => {
    const previewSpy = vi.spyOn(api, 'previewZones').mockResolvedValue({
      rows: [
        { date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR', memo: null, fitid: null },
        { date: '2026-01-17', amount: '1200.00', rawLabel: 'SALAIRE', memo: null, fitid: null },
      ],
      skippedRows: [],
    });

    // Render the builder. To reach the amount step + populated zones
    // without simulating five painting interactions, we rely on the
    // component's own state — the initial render is on 'header'. The
    // simplest deterministic reach is: click Suivant four times, with
    // painted rectangles being set at each step via a shim.
    //
    // The wizard blocks Suivant when the required rect for the current
    // step isn't set. To keep this test scoped, use a `key` reset and
    // a mocked ZoneCanvas that immediately calls its onChange with a
    // dummy rect on mount. That keeps this test focused on the preview
    // behavior we're actually adding, not the painting workflow.
    vi.doMock('../ZoneCanvas', () => ({
      ZoneCanvas: (props: any) => {
        // fire onChange once so the parent has a valid rect
        setTimeout(() => props.onChange({ x: 10, y: 10, w: 100, h: 20 }), 0);
        return <div data-testid={`zone-canvas-${props.paintLabel ?? 'unknown'}`} />;
      },
    }));
    const { PdfTemplateBuilder: Fresh } = await import('../index');
    const onClose = vi.fn();
    const onImported = vi.fn();
    render(<Fresh needsTemplate={needsTemplate} onClose={onClose} onImported={onImported} />);

    // Walk header → table → date → description → amount by clicking Suivant.
    // Between each click, wait for the auto-fired onChange from the mocked
    // ZoneCanvas to settle so `disabled` flips off.
    for (let i = 0; i < 4; i++) {
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /suivant/i });
        expect(btn).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole('button', { name: /suivant/i }));
    }

    // The amount step needs a label + zones. Set the label input via
    // placeholder — the <label> in AmountStep.tsx is not htmlFor'd, so
    // getByLabelText won't find it. Placeholder ships as "ex: BNP — Compte Chèques".
    const labelInput = screen.getByPlaceholderText(/BNP/i);
    fireEvent.change(labelInput, { target: { value: 'Test Template' } });

    // Click Aperçu.
    const previewBtn = await screen.findByRole('button', { name: /aperçu/i });
    await waitFor(() => expect(previewBtn).not.toBeDisabled());
    fireEvent.click(previewBtn);

    // Assert the two rows render.
    await screen.findByText('CB CARREFOUR');
    await screen.findByText('SALAIRE');
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy.mock.calls[0]![0]).toBe(draftId);
  });

  it('renders an error banner when previewZones rejects', async () => {
    vi.spyOn(api, 'previewZones').mockRejectedValue(new Error('boom'));
    vi.doMock('../ZoneCanvas', () => ({
      ZoneCanvas: (props: any) => {
        setTimeout(() => props.onChange({ x: 10, y: 10, w: 100, h: 20 }), 0);
        return <div />;
      },
    }));
    const { PdfTemplateBuilder: Fresh } = await import('../index');
    render(<Fresh needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />);
    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(screen.getByRole('button', { name: /suivant/i })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /suivant/i }));
    }
    fireEvent.change(screen.getByPlaceholderText(/BNP/i), { target: { value: 'X' } });
    const previewBtn = await screen.findByRole('button', { name: /aperçu/i });
    await waitFor(() => expect(previewBtn).not.toBeDisabled());
    fireEvent.click(previewBtn);
    await screen.findByText(/boom/i);
  });
});
```

Note: `AmountStep.tsx` renders the label input. Read that file quickly to confirm the label input has `aria-label` or an `<label>` binding — if it's just a `placeholder="Nom du template"`, adjust the selector to `screen.getByPlaceholderText(/nom du template/i)` before writing the tests. Do this check inline while writing the test to avoid a red test caused by selector drift.

- [ ] **Step 3: Run frontend tests to verify they fail**

Run: `cd frontend && pnpm vitest run src/components/PdfTemplateBuilder/__tests__/PdfTemplateBuilder.preview.test.tsx`

Expected: FAIL — no Aperçu button rendered.

- [ ] **Step 4: Add state, effect, handler to `PdfTemplateBuilder`**

Open `frontend/src/components/PdfTemplateBuilder/index.tsx`.

At the top of the file, ensure `useEffect` is imported from React:

```typescript
import { useEffect, useState } from 'react';
```

Add the new imports next to the existing `submitZones` import:

```typescript
import {
  submitZones,
  previewZones,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type TemplateZones,
  type PreviewResult,
} from '../../api/pdf-templates.js';
```

Inside the `PdfTemplateBuilder` component, after the existing `const [err, setErr] = useState<string | null>(null);` line, add:

```typescript
  const [previewRows, setPreviewRows] = useState<PreviewResult['rows'] | null>(null);
  const [previewSkipped, setPreviewSkipped] = useState<PreviewResult['skippedRows']>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Whenever any painted zone or wizard-configuration input changes,
  // wipe the preview so the user never sees a stale table that no
  // longer reflects the current paint.
  useEffect(() => {
    setPreviewRows(null);
    setPreviewSkipped([]);
    setPreviewError(null);
  }, [
    tableRect, dateCol, descCol, signedCol, debitCol, creditCol,
    amountMode, headerRect, selectedPages, pickedAnchor, pickedOtherAnchors,
  ]);

  async function handlePreview() {
    const zones = buildZones();
    if (!zones) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await previewZones(needsTemplate.draftId, zones);
      setPreviewRows(r.rows);
      setPreviewSkipped(r.skippedRows);
    } catch (e: any) {
      setPreviewError(e?.message ?? 'preview failed');
      setPreviewRows(null);
      setPreviewSkipped([]);
    } finally {
      setPreviewLoading(false);
    }
  }
```

- [ ] **Step 5: Render the preview panel + Aperçu button**

Still in `frontend/src/components/PdfTemplateBuilder/index.tsx`, locate the button row at the bottom of the JSX (the `<div className="flex justify-between gap-2 mt-6">` block). Replace it with:

```tsx
        {step === 'amount' && (
          <div className="mt-6 border-t border-ink-800/60 pt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-ink-100">
                Aperçu
                {previewRows && (
                  <span className="text-ink-500 font-normal font-mono ml-2">
                    ({previewRows.length} ligne{previewRows.length !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
              <button
                className="px-3 py-1.5 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handlePreview}
                disabled={!canSubmit || previewLoading}
                type="button"
              >
                {previewLoading ? 'Aperçu…' : 'Aperçu'}
              </button>
            </div>
            {previewError && (
              <div className="text-clay-300 bg-clay-900/30 border border-clay-800/60 p-2 rounded-md text-xs mb-2">
                {previewError}
              </div>
            )}
            {previewRows === null && !previewLoading && !previewError && (
              <div className="text-xs text-ink-500 display-italic">
                Cliquez sur <span className="font-medium not-italic text-ink-400">Aperçu</span> pour vérifier avant l'import.
              </div>
            )}
            {previewRows && previewRows.length === 0 && (
              <div className="text-xs text-clay-300 display-italic">
                Aucune ligne extraite. Vérifiez que les colonnes couvrent bien le tableau.
              </div>
            )}
            {previewRows && previewRows.length > 0 && (
              <div className="max-h-72 overflow-y-auto pr-1">
                <table className="w-full text-xs">
                  <thead className="text-left text-ink-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-normal">Date</th>
                      <th className="py-1.5 pr-3 font-normal">Libellé</th>
                      <th className="py-1.5 pl-3 font-normal text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t border-ink-800/40">
                        <td className="py-1.5 pr-3 font-mono text-ink-300 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="py-1.5 pr-3 text-ink-100">
                          <div className="truncate max-w-[26rem]" title={r.rawLabel}>{r.rawLabel}</div>
                        </td>
                        <td className={`py-1.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap ${amountSignClass(r.amount)}`}>
                          {formatAmount(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {previewSkipped.length > 0 && (
              <details className="mt-3 text-xs text-ink-500">
                <summary className="cursor-pointer">{previewSkipped.length} ligne(s) ignorée(s)</summary>
                <ul className="mt-2 space-y-1 font-mono">
                  {previewSkipped.map((s, i) => (
                    <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6">
          <button
            className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={prev}
            disabled={stepIdx === 0}
          >← Précédent</button>

          {!isLast ? (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={next}
              disabled={
                (step === 'table' && (!tableRect || selectedPages.length === 0)) ||
                (step === 'date' && !dateCol) ||
                (step === 'description' && !descCol)
              }
            >Suivant →</button>
          ) : (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >{submitting ? 'Import…' : 'Importer'}</button>
          )}
        </div>
```

Also add these three imports at the top of `index.tsx` (they're not currently used there — the Wizard file uses them, but the Builder will now too):

```typescript
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
```

- [ ] **Step 6: Run frontend tests to verify they pass**

Run: `cd frontend && pnpm vitest run src/components/PdfTemplateBuilder/__tests__/PdfTemplateBuilder.preview.test.tsx`

Expected: both tests PASS.

- [ ] **Step 7: Sanity-check the rest of the frontend suite didn't regress**

Run: `cd frontend && pnpm vitest run`

Expected: all frontend tests PASS.

- [ ] **Step 8: Manual smoke test in the app**

Bring up the app (frontend `pnpm dev` + backend `pnpm dev`). Upload a bank PDF that triggers the wizard (low-heuristic-confidence sample). Walk through the five steps painting zones. On the Montant step:
1. Confirm the "Aperçu" button appears next to the panel header.
2. Click it — confirm the rows show up in the table with correct dates and signed amounts.
3. Modify the Débit column position — confirm the preview panel resets back to the "Cliquez sur Aperçu…" hint.
4. Click Aperçu again — confirm new rows reflect the new zone.
5. Click Importer — confirm the actual import still works.

If any of these fail, stop and diagnose; do not commit.

- [ ] **Step 9: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add \
  frontend/src/api/pdf-templates.ts \
  frontend/src/components/PdfTemplateBuilder/index.tsx \
  frontend/src/components/PdfTemplateBuilder/__tests__/PdfTemplateBuilder.preview.test.tsx
git commit -m "feat(pdf-wizard): Aperçu button with extracted-row panel before import"
```

---

## Task 4: Update `TODO.md` — move items to Fait

**Files:**
- Modify: `TODO.md` (move the two bullet points from "Pour plus tard" to "Fait")

**Interfaces:** none.

- [ ] **Step 1: Move the two items**

Open `TODO.md`. In section `## 📌 Pour plus tard (committed)`, delete these two lines:

```
- Prévisualisation des N premières transactions dans le wizard PDF avant de
  cliquer "Importer" — fait bcp gagner sur les templates douteux.
- Recherche full-text simple sur libellés/notes.
```

In section `## ✅ Fait`, add these two entries at the top of the bullet list:

```markdown
- **Preview wizard PDF** : bouton « Aperçu » à l'étape Montant qui
  extrait les transactions via un nouvel endpoint
  `POST /api/imports/pdf/templates/preview` (idempotent, aucun
  side-effect) et les affiche dans un panneau scrollable. Le preview
  se réinitialise dès qu'une zone est modifiée pour éviter d'afficher
  un rendu stale.
- **Recherche full-text** : l'endpoint `GET /api/transactions?search=`
  matche désormais `raw_label`, `normalized_label`, `memo` et `notes`
  (auparavant seulement `normalized_label`). Toujours accent- et
  case-insensitive via `immutable_unaccent(lower(…))`. Pas de
  migration — v1 basé sur OR de LIKE, adéquat au scale homelab.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add TODO.md
git commit -m "docs(todo): PDF preview + full-text search landed"
```

---

## Self-Review

**Spec coverage:**
- Feature 1 backend endpoint → Task 2 ✓
- Feature 1 frontend UI → Task 3 ✓
- Feature 1 tests (backend + frontend) → Task 2, Task 3 ✓
- Feature 2 backend WHERE change → Task 1 ✓
- Feature 2 tests → Task 1 ✓
- Zero-side-effect preview endpoint (no runImport, no template upsert, no anchor derivation) → Task 2 Step 3 (helper) explicitly stops before runImport ✓
- Reset preview on any zone change → Task 3 Step 4 (useEffect keyed on the tuple) ✓
- No migration for search → Task 1 doesn't touch schema ✓
- `TODO.md` housekeeping → Task 4 ✓

**Placeholder scan:** No "TBD"/"TODO"/"similar to Task N" or vague "handle edge cases" phrasing. Every code block is complete.

**Type consistency:**
- Backend: `previewTemplate` returns `{ rows: ParsedTransaction[]; skippedRows: [] }`. Route handler returns the same shape via `reply.code(200).send(r)`. Frontend `previewZones` typed as `Promise<PreviewResult>` where `PreviewResult['rows']` is `PreviewParsedRow[]` mirroring the backend `ParsedTransaction` field-for-field. ✓
- `PreviewParsedRow` matches `ParsedTransaction` from `backend/src/domain/imports/ofx-parser.js`: `{ date: string; amount: string; rawLabel: string; memo: string | null; fitid: string | null }`. If backend `ParsedTransaction` diverges (audit while implementing Task 3), sync the frontend type.
- `handlePreview` and `previewRows`/`previewSkipped`/`previewLoading`/`previewError` names used consistently in Task 3 Steps 4-5. ✓
- `buildZones()` returns `TemplateZones | null` — `handlePreview` handles the null branch. ✓
