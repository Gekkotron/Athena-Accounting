# PDF Bank Statement Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept bank statement PDFs as a new import format, automatically extracting transactions from text-layer PDFs via a heuristic, falling back to an interactive zone-painting flow that learns a per-bank template for next time.

**Architecture:** A new PDF branch in `backend/src/domain/imports/pdf/` produces the same `ParsedTransaction[]` shape as the OFX/CSV parsers, so it plugs straight into the existing `runImport` chain (normalize → dedup → categorize → transfer-detect). Templates are fingerprinted from a normalized header region of page 1; matching PDFs auto-import without UI. Non-matching PDFs are parked as drafts and the user paints zones in a frontend modal that submits to a new endpoint.

**Tech Stack:** Node 20, Fastify 5, TypeScript ESM (`.js` import suffixes), Drizzle ORM, PostgreSQL 16, React 18 + TanStack Query. New runtime deps: `pdfjs-dist` (text extraction + page rendering), `@napi-rs/canvas` (canvas surface for pdfjs page rendering). New dev dep: `pdfkit` (generates tiny synthetic PDFs in tests; no committed binaries).

## Global Constraints

- **Text-layer PDFs only in v1.** Scanned/image PDFs are detected and surfaced; OCR is explicitly out of scope.
- **No LLM, no cloud calls.** Everything runs locally. The README's "your bank data never leaves your network" guarantee must hold.
- **All endpoints sit behind `app.requireAuth`** (the existing session-cookie auth plugin).
- **PDF parser must produce `ParsedTransaction[]`** (the existing shape in `backend/src/domain/imports/ofx-parser.ts`) so the downstream chain is untouched.
- **PK style: `serial`/`bigserial`.** New tables use `serial id`. `account_id` is `integer` (matches `accounts.id`).
- **Migration numbering: lexicographic.** Next file is `0003_pdf_import.sql`.
- **ESM import style: `.js` suffix in TypeScript source** (e.g. `from '../../db/client.js'`).
- **French defaults:** date `JJ/MM/AAAA` or `JJ/MM/AA`, decimal `,`, thousands separator non-breaking-space or regular space.
- **File size cap for uploads:** 20 MB (matches existing `imports.ts`).
- **No comments unless WHY is non-obvious.** Match the surrounding files' tone.

---

## File Structure

**Backend — new files:**

- `backend/src/db/migrations/0003_pdf_import.sql` — adds `'pdf'` to `import_format` enum; creates `pdf_statement_templates` and `pdf_import_drafts`.
- `backend/src/domain/imports/pdf/text-extract.ts` — `pdfjs-dist` wrapper. `extractText(buf): Promise<PdfPageText[]>`.
- `backend/src/domain/imports/pdf/fingerprint.ts` — pure: `fingerprintHeader(pageOneItems, headerHeightRatio): string`.
- `backend/src/domain/imports/pdf/heuristic.ts` — pure: `runHeuristic(pages): HeuristicResult`.
- `backend/src/domain/imports/pdf/template-apply.ts` — pure: `applyTemplate(pages, zones): { rows, skippedRows }`.
- `backend/src/domain/imports/pdf/render.ts` — `renderPagesToPng(buf): Promise<RenderedPage[]>`.
- `backend/src/domain/imports/pdf/index.ts` — orchestrator: `importPdf(opts): Promise<ImportPdfResult>`.
- `backend/src/domain/imports/pdf/draft-sweeper.ts` — `sweepExpiredDrafts(): Promise<number>` and `startDraftSweeper(app)`.
- `backend/src/http/routes/pdf-templates.ts` — CRUD on `pdf_statement_templates`.

**Backend — modified files:**

- `backend/src/db/schema.ts` — extend `importFormatEnum`, add two new tables.
- `backend/src/domain/imports/import-service.ts` — `ImportFormat` gains `'pdf'`; `inferFormat` returns `'pdf'` for `.pdf`; `parseFile` rejects `'pdf'` (PDF path handled by its own orchestrator, not `runImport`).
- `backend/src/http/routes/imports.ts` — dispatch `.pdf` uploads to `importPdf`; add `POST /api/imports/pdf/templates`.
- `backend/src/server.ts` — register `pdfTemplatesRoutes`; call `startDraftSweeper`.

**Backend — tests:**

- `backend/tests/imports/pdf-fingerprint.test.ts`
- `backend/tests/imports/pdf-heuristic.test.ts`
- `backend/tests/imports/pdf-template-apply.test.ts`
- `backend/tests/imports/pdf-roundtrip.test.ts` (heuristic ↔ template-apply parity)
- `backend/tests/imports/pdf-text-extract.test.ts` (uses `pdfkit`-generated buffer)
- `backend/tests/imports/pdf-render.test.ts` (uses `pdfkit`-generated buffer)
- `backend/tests/fixtures/pdf/README.md` (anonymization procedure)
- `backend/tests/fixtures/pdf/.gitkeep`

**Frontend — new files:**

- `frontend/src/api/pdf-templates.ts` — typed fetch wrappers.
- `frontend/src/components/PdfTemplateBuilder/index.tsx` — three-step modal.
- `frontend/src/components/PdfTemplateBuilder/ZoneCanvas.tsx` — drag-to-paint a rectangle on a rendered page.
- `frontend/src/components/PdfTemplateBuilder/ColumnMapper.tsx` — labels columns inside the table zone.

**Frontend — modified files:**

- `frontend/src/pages/Imports.tsx` — when `POST /api/imports` returns `{ needsTemplate }`, open `<PdfTemplateBuilder>`.

---

## Type contracts (shared across tasks)

These are the names and shapes later tasks rely on. Define them in the file each task creates; do not re-invent.

```ts
// text-extract.ts
export interface PdfTextItem {
  pageIndex: number;          // 0-based
  str: string;
  xLeft: number;              // page-user-space, origin top-left
  yTop: number;
  width: number;
  height: number;
}
export interface PdfPageText {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  items: PdfTextItem[];
}

// shared zones type (lives in pdf/zones.ts, see Task 1)
export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';
export interface ZoneRect { page: number; x: number; y: number; w: number; h: number }
export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

// heuristic.ts
export interface HeuristicResult {
  zones: TemplateZones | null;
  rows: ParsedTransaction[];        // from ofx-parser.ts
  confidence: number;               // 0..1
  skippedRows: Array<{ rowText: string; reason: string }>;
}

// template-apply.ts
export interface ApplyResult {
  rows: ParsedTransaction[];
  skippedRows: Array<{ rowText: string; reason: string }>;
}

// orchestrator (pdf/index.ts)
export type ImportPdfResult =
  | { kind: 'imported'; result: ImportResult; skippedRows: Array<{ rowText: string; reason: string }> }
  | { kind: 'needs_template'; draftId: number; fingerprint: string;
      pages: Array<{ pageIndex: number; pngBase64: string; widthPt: number; heightPt: number }>;
      textItems: PdfTextItem[];
      suggestedZones: TemplateZones | null };
```

---

## Task 1: DB migration + schema update

**Files:**
- Create: `backend/src/db/migrations/0003_pdf_import.sql`
- Create: `backend/src/domain/imports/pdf/zones.ts` (shared types — no logic)
- Modify: `backend/src/db/schema.ts`
- Test: `backend/tests/imports/pdf-migration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `pdfStatementTemplates`, `pdfImportDrafts` exports from `schema.ts`; `'pdf'` added to `importFormatEnum`; type exports from `zones.ts` (`ColumnRole`, `ZoneRect`, `TemplateZones`).

- [ ] **Step 1: Write the failing test**

`backend/tests/imports/pdf-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../../src/db/client.js';
import { sql } from 'drizzle-orm';

describe('0003_pdf_import migration', () => {
  it('adds "pdf" to import_format enum', async () => {
    const rows = await db.execute(sql`
      SELECT unnest(enum_range(NULL::import_format))::text AS v
    `);
    const values = rows.rows.map((r: any) => r.v);
    expect(values).toEqual(expect.arrayContaining(['ofx', 'csv', 'pdf']));
  });

  it('creates pdf_statement_templates with fingerprint UNIQUE', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'pdf_statement_templates' ORDER BY ordinal_position
    `);
    const cols = rows.rows.map((r: any) => r.column_name);
    expect(cols).toEqual([
      'id', 'fingerprint', 'label', 'zones', 'source', 'created_at', 'updated_at',
    ]);
    const idx = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'pdf_statement_templates' AND indexname LIKE '%fingerprint%'
    `);
    expect(idx.rows.length).toBeGreaterThan(0);
  });

  it('creates pdf_import_drafts with FK to accounts and expires_at index', async () => {
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'pdf_import_drafts' ORDER BY ordinal_position
    `);
    const cols = rows.rows.map((r: any) => r.column_name);
    expect(cols).toEqual([
      'id', 'account_id', 'pdf_bytes', 'text_items', 'fingerprint', 'created_at', 'expires_at',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-migration`

Expected: FAIL — `import_format` enum has no `'pdf'` value, tables don't exist.

- [ ] **Step 3: Write the migration**

`backend/src/db/migrations/0003_pdf_import.sql`:

```sql
-- PDF bank statement import — adds the format enum value plus two tables:
-- pdf_statement_templates (one row per learned bank layout, keyed by content
-- fingerprint) and pdf_import_drafts (a parked upload while the user paints
-- zones in the UI).

ALTER TYPE import_format ADD VALUE IF NOT EXISTS 'pdf';

CREATE TABLE pdf_statement_templates (
  id           SERIAL PRIMARY KEY,
  fingerprint  TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  zones        JSONB NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('heuristic', 'interactive')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pdf_import_drafts (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pdf_bytes    BYTEA NOT NULL,
  text_items   JSONB NOT NULL,
  fingerprint  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX pdf_import_drafts_expires_at_idx ON pdf_import_drafts(expires_at);
```

- [ ] **Step 4: Write the shared zones types file**

`backend/src/domain/imports/pdf/zones.ts`:

```ts
export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

export function validateZones(z: TemplateZones): void {
  const dateCount = z.columns.filter((c) => c.role === 'date').length;
  const descCount = z.columns.filter((c) => c.role === 'description').length;
  const signedCount = z.columns.filter((c) => c.role === 'amountSigned').length;
  const debitCount = z.columns.filter((c) => c.role === 'debit').length;
  const creditCount = z.columns.filter((c) => c.role === 'credit').length;
  if (dateCount !== 1) throw new Error('zones: exactly one date column required');
  if (descCount !== 1) throw new Error('zones: exactly one description column required');
  const hasSigned = signedCount === 1 && debitCount === 0 && creditCount === 0;
  const hasPair = signedCount === 0 && debitCount === 1 && creditCount === 1;
  if (!hasSigned && !hasPair) {
    throw new Error('zones: need either one amountSigned column OR one debit + one credit');
  }
}
```

- [ ] **Step 5: Update Drizzle schema**

In `backend/src/db/schema.ts`:

Change the enum line:

```ts
export const importFormatEnum = pgEnum('import_format', ['ofx', 'csv', 'pdf']);
```

Add the two tables (append at end of file, before any trailing exports):

```ts
import { jsonb } from 'drizzle-orm/pg-core';
// ^ add jsonb to the existing pg-core import at top, don't add a second import line

export const pdfStatementTemplates = pgTable('pdf_statement_templates', {
  id: serial('id').primaryKey(),
  fingerprint: text('fingerprint').notNull().unique(),
  label: text('label').notNull(),
  zones: jsonb('zones').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pdfImportDrafts = pgTable(
  'pdf_import_drafts',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    pdfBytes: text('pdf_bytes').notNull(),
    textItems: jsonb('text_items').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    idxExpires: index('pdf_import_drafts_expires_at_idx').on(t.expiresAt),
  }),
);
```

Note: Drizzle has no `bytea` helper exposed in the version used here; declaring the column as `text` makes Drizzle drop the column-type generation responsibility — the migration above already created the column as `BYTEA`. At the query layer (Task 8), we pass `Buffer` and the `pg` driver round-trips it to bytea correctly. The Drizzle declaration is for selection ergonomics only.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm run dev` once to apply the migration, then `npm test -- pdf-migration`.

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0003_pdf_import.sql \
        backend/src/domain/imports/pdf/zones.ts \
        backend/src/db/schema.ts \
        backend/tests/imports/pdf-migration.test.ts
git commit -m "feat(pdf-import): db schema for templates and import drafts"
```

---

## Task 2: PDF text extraction wrapper

**Files:**
- Create: `backend/src/domain/imports/pdf/text-extract.ts`
- Test: `backend/tests/imports/pdf-text-extract.test.ts`
- Modify: `backend/package.json` (add `pdfjs-dist` runtime dep, `pdfkit` dev dep)

**Interfaces:**
- Consumes: nothing (calls into `pdfjs-dist`)
- Produces: `extractText(buf: Buffer): Promise<PdfPageText[]>` and the types `PdfTextItem`, `PdfPageText`.

- [ ] **Step 1: Add dependencies**

Run:

```bash
cd backend && npm install pdfjs-dist@4.10.38 && npm install --save-dev pdfkit@0.15.1 @types/pdfkit@0.13.5
```

- [ ] **Step 2: Write the failing test**

`backend/tests/imports/pdf-text-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractText } from '../../src/domain/imports/pdf/text-extract.js';

function buildPdf(lines: Array<{ text: string; x: number; y: number }>): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica').fontSize(10);
    for (const { text, x, y } of lines) {
      doc.text(text, x, y, { lineBreak: false });
    }
    doc.end();
  });
}

describe('extractText', () => {
  it('returns text items with positions from a one-page PDF', async () => {
    const buf = await buildPdf([
      { text: 'BANQUE EXAMPLE', x: 40, y: 40 },
      { text: '15/01/2026', x: 40, y: 200 },
      { text: 'CB CARREFOUR', x: 120, y: 200 },
      { text: '-42,30', x: 480, y: 200 },
    ]);
    const pages = await extractText(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.pageIndex).toBe(0);
    expect(pages[0]!.widthPt).toBeGreaterThan(500);   // A4 = 595pt
    const strs = pages[0]!.items.map((i) => i.str);
    expect(strs).toEqual(expect.arrayContaining(['BANQUE EXAMPLE', '15/01/2026', '-42,30']));
    const date = pages[0]!.items.find((i) => i.str === '15/01/2026')!;
    expect(date.xLeft).toBeGreaterThan(30);
    expect(date.xLeft).toBeLessThan(60);
  });

  it('handles multi-page documents', async () => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    const promise = new Promise<Buffer>((r) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => r(Buffer.concat(chunks)));
    });
    doc.text('Page 1', 40, 40);
    doc.addPage();
    doc.text('Page 2', 40, 40);
    doc.end();
    const buf = await promise;
    const pages = await extractText(buf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.items[0]!.str).toBe('Page 1');
    expect(pages[1]!.items[0]!.str).toBe('Page 2');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-text-extract`

Expected: FAIL — `extractText` not found.

- [ ] **Step 4: Implement `text-extract.ts`**

`backend/src/domain/imports/pdf/text-extract.ts`:

```ts
// pdfjs-dist ships an ESM "legacy" build that runs in plain Node without a DOM.
// We import it lazily because the module does its own globalThis poking on first
// require and we want server startup to remain cheap.
import type { TextItem } from 'pdfjs-dist/types/src/display/api.d.ts';

export interface PdfTextItem {
  pageIndex: number;
  str: string;
  xLeft: number;
  yTop: number;
  width: number;
  height: number;
}

export interface PdfPageText {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  items: PdfTextItem[];
}

let pdfjsModule: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function loadPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModule;
}

export async function extractText(buf: Buffer): Promise<PdfPageText[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  try {
    const pages: PdfPageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const item = raw as TextItem;
        // transform = [a, b, c, d, e, f]. e = x in pdf user space (origin
        // bottom-left). f = y baseline. Convert to top-left origin so the
        // heuristic's "row Y" intuition matches what the user sees on screen.
        const [, , , , e, f] = item.transform;
        const yTop = viewport.height - f - item.height;
        items.push({
          pageIndex: i - 1,
          str: item.str,
          xLeft: e,
          yTop,
          width: item.width,
          height: item.height,
        });
      }
      pages.push({
        pageIndex: i - 1,
        widthPt: viewport.width,
        heightPt: viewport.height,
        items,
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export class PdfEncryptedError extends Error {
  code = 'pdf_encrypted' as const;
}
```

Wrap the `getDocument(...).promise` call in a try/catch around it (caller-level) — pdfjs throws `PasswordException` on encrypted files. Add this to the function body, replacing the `try` block top:

```ts
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new PdfEncryptedError('PDF is password-protected');
    throw err;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-text-extract`

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json \
        backend/src/domain/imports/pdf/text-extract.ts \
        backend/tests/imports/pdf-text-extract.test.ts
git commit -m "feat(pdf-import): pdfjs-dist wrapper for text + position extraction"
```

---

## Task 3: Fingerprint function

**Files:**
- Create: `backend/src/domain/imports/pdf/fingerprint.ts`
- Test: `backend/tests/imports/pdf-fingerprint.test.ts`

**Interfaces:**
- Consumes: `PdfPageText` from `text-extract.ts`
- Produces: `fingerprintHeader(page: PdfPageText, headerHeightRatio?: number): string`, `defaultHeaderZone(page: PdfPageText): ZoneRect`, `fingerprintFromZone(page: PdfPageText, zone: ZoneRect): string`.

- [ ] **Step 1: Write the failing test**

`backend/tests/imports/pdf-fingerprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  fingerprintHeader,
  fingerprintFromZone,
  defaultHeaderZone,
} from '../../src/domain/imports/pdf/fingerprint.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('fingerprintHeader', () => {
  it('is stable across statements with different dates and balances', () => {
    const jan = page([
      item('BANQUE EXAMPLE', 40, 30),
      item('Relevé de compte n° 12345', 40, 60),
      item('Période: 01/01/2026 - 31/01/2026', 40, 90),
      item('Solde: 1 234,56 EUR', 40, 120),
    ]);
    const feb = page([
      item('BANQUE EXAMPLE', 40, 30),
      item('Relevé de compte n° 67890', 40, 60),
      item('Période: 01/02/2026 - 28/02/2026', 40, 90),
      item('Solde: 2 998,17 EUR', 40, 120),
    ]);
    expect(fingerprintHeader(jan)).toBe(fingerprintHeader(feb));
  });

  it('differs between different banks', () => {
    const a = page([item('BANQUE A', 40, 30), item('Le relevé', 40, 60)]);
    const b = page([item('BANK B', 40, 30), item('Statement', 40, 60)]);
    expect(fingerprintHeader(a)).not.toBe(fingerprintHeader(b));
  });

  it('ignores diacritics, case, and whitespace runs', () => {
    const a = page([item('BANQUE EXAMPLE  Relevé', 40, 30)]);
    const b = page([item('banque example releve', 40, 30)]);
    expect(fingerprintHeader(a)).toBe(fingerprintHeader(b));
  });

  it('defaultHeaderZone returns the top 15% of the page', () => {
    const p = page([]);
    const z = defaultHeaderZone(p);
    expect(z).toEqual({ page: 0, x: 0, y: 0, w: 595, h: 842 * 0.15 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-fingerprint`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fingerprint.ts`**

`backend/src/domain/imports/pdf/fingerprint.ts`:

```ts
import { createHash } from 'node:crypto';
import type { PdfPageText } from './text-extract.js';
import type { ZoneRect } from './zones.js';

const HEADER_HEIGHT_RATIO = 0.15;

export function defaultHeaderZone(page: PdfPageText): ZoneRect {
  return {
    page: 0,
    x: 0,
    y: 0,
    w: page.widthPt,
    h: page.heightPt * HEADER_HEIGHT_RATIO,
  };
}

// Stable across statements from the same bank+layout:
// - strip digits (dates, account numbers, balances change month-to-month)
// - strip accents
// - lowercase
// - collapse all whitespace
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\d/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function itemsInZone(page: PdfPageText, zone: ZoneRect): string {
  return page.items
    .filter((it) => it.yTop >= zone.y && it.yTop <= zone.y + zone.h)
    .filter((it) => it.xLeft >= zone.x && it.xLeft <= zone.x + zone.w)
    .sort((a, b) => a.yTop - b.yTop || a.xLeft - b.xLeft)
    .map((it) => it.str)
    .join(' ');
}

export function fingerprintFromZone(page: PdfPageText, zone: ZoneRect): string {
  const joined = itemsInZone(page, zone);
  return createHash('sha256').update(normalize(joined)).digest('hex');
}

export function fingerprintHeader(page: PdfPageText): string {
  return fingerprintFromZone(page, defaultHeaderZone(page));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-fingerprint`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/imports/pdf/fingerprint.ts \
        backend/tests/imports/pdf-fingerprint.test.ts
git commit -m "feat(pdf-import): stable header fingerprint, accent/digit-insensitive"
```

---

## Task 4: Heuristic extractor

**Files:**
- Create: `backend/src/domain/imports/pdf/heuristic.ts`
- Test: `backend/tests/imports/pdf-heuristic.test.ts`

**Interfaces:**
- Consumes: `PdfPageText`, `PdfTextItem` from `text-extract.ts`; `TemplateZones`, `ColumnRole`, `ZoneRect` from `zones.ts`; `ParsedTransaction` from `ofx-parser.ts`.
- Produces: `runHeuristic(pages: PdfPageText[]): HeuristicResult` plus shared helpers `parseFrenchDate(s): string | null`, `parseFrenchAmount(s): string | null` (already exist in `csv-parser.ts` but are not exported — re-export them as part of this task by moving to a new shared file).

- [ ] **Step 1: Extract shared parsers**

Move `parseFrenchDate` and `parseFrenchAmount` from `csv-parser.ts` to a new shared file so the heuristic can reuse them without duplication.

Create `backend/src/domain/imports/french-numerics.ts`:

```ts
export function parseFrenchDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) throw new Error(`invalid French date: ${JSON.stringify(s)}`);
  let [, d, mo, y] = m;
  if (y!.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

export function tryParseFrenchDate(s: string): string | null {
  try { return parseFrenchDate(s); } catch { return null; }
}

export function parseFrenchAmount(s: string): string {
  if (!s || !s.trim()) return '';
  let v = s.replace(/[€$\s ]/g, '').trim();
  v = v.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(v)) {
    throw new Error(`invalid amount: ${JSON.stringify(s)}`);
  }
  return Number(v).toFixed(2);
}

export function tryParseFrenchAmount(s: string): string | null {
  try {
    const r = parseFrenchAmount(s);
    return r === '' ? null : r;
  } catch { return null; }
}
```

In `backend/src/domain/imports/csv-parser.ts`, remove the now-duplicated `parseFrenchDate` and `parseFrenchAmount` and import them from the new file:

```ts
import { parseFrenchDate, parseFrenchAmount } from './french-numerics.js';
```

- [ ] **Step 2: Verify nothing broke**

Run: `cd backend && npm test -- csv`

Expected: existing CSV tests still pass.

- [ ] **Step 3: Write the failing heuristic test**

`backend/tests/imports/pdf-heuristic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('runHeuristic', () => {
  it('detects a signed-amount table with high confidence', () => {
    const items: PdfTextItem[] = [
      item('Banque Example', 40, 30),
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 235), item('VIR LOYER',     120, 235), item('-850,00', 480, 235),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250), item('1 200,00', 480, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      date: '2026-01-15',
      amount: '-42.30',
      rawLabel: 'CB CARREFOUR',
    });
    expect(result.rows[2]!.amount).toBe('1200.00');
    expect(result.zones).not.toBeNull();
    expect(result.zones!.columns.find((c) => c.role === 'date')).toBeDefined();
    expect(result.zones!.columns.find((c) => c.role === 'amountSigned')).toBeDefined();
  });

  it('detects a débit/crédit pair with positive credit, negative debit', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200),
      item('Débit', 400, 200), item('Crédit', 500, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250),                            item('1 200,00', 500, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.rows.map((r) => r.amount)).toEqual(['-42.30', '1200.00']);
  });

  it('returns confidence 0 when no rows parse', () => {
    const result = runHeuristic([page([item('Just some marketing text', 40, 200)])]);
    expect(result.confidence).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('returns suggestedZones for medium-confidence input', () => {
    // 3 well-formed rows + 2 garbage rows mixed in → confidence ~ 0.6
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('reportable', 40, 235), item('-', 120, 235), item('-', 480, 235),
      item('16/01/2026', 40, 250), item('VIR LOYER',     120, 250), item('-850,00', 480, 250),
      item('also bad', 40, 265), item('???', 120, 265), item('???', 480, 265),
      item('17/01/2026', 40, 280), item('SALAIRE',       120, 280), item('1 200,00', 480, 280),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.zones).not.toBeNull();
  });

  it('handles multi-page repeating tables', () => {
    const tableRows = (yStart: number) => [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, yStart),     item('A', 120, yStart),     item('-1,00', 480, yStart),
      item('16/01/2026', 40, yStart + 15), item('B', 120, yStart + 15), item('-2,00', 480, yStart + 15),
    ];
    const pages: PdfPageText[] = [page(tableRows(220)), page(tableRows(220))];
    const result = runHeuristic(pages);
    expect(result.rows).toHaveLength(4);
    expect(result.zones!.tableRepeatsPerPage).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-heuristic`

Expected: FAIL — `runHeuristic` not found.

- [ ] **Step 5: Implement `heuristic.ts`**

`backend/src/domain/imports/pdf/heuristic.ts`:

```ts
import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones, ColumnRole, ZoneRect } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';

export interface HeuristicResult {
  zones: TemplateZones | null;
  rows: ParsedTransaction[];
  confidence: number;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

const ROW_Y_TOLERANCE_PT = 2;        // group items into a row when their yTop differs by ≤ this
const DATE_RE = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{2}|\d{4})$/;
const AMOUNT_RE = /^-?\d{1,3}(?:[  ]\d{3})*,\d{2}$/;

interface Row {
  yTop: number;
  items: PdfTextItem[];
}

function clusterRows(items: PdfTextItem[]): Row[] {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop);
  const rows: Row[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last.yTop) <= ROW_Y_TOLERANCE_PT) {
      last.items.push(it);
    } else {
      rows.push({ yTop: it.yTop, items: [it] });
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.xLeft - b.xLeft);
  return rows;
}

interface ColumnCluster {
  xStart: number;
  xEnd: number;
  values: string[];
}

function clusterColumns(rows: Row[]): ColumnCluster[] {
  const xPoints = rows.flatMap((r) => r.items.map((i) => i.xLeft)).sort((a, b) => a - b);
  if (xPoints.length === 0) return [];
  const clusters: Array<{ xStart: number; xEnd: number }> = [{ xStart: xPoints[0]!, xEnd: xPoints[0]! }];
  for (const x of xPoints.slice(1)) {
    const last = clusters[clusters.length - 1]!;
    if (x - last.xEnd <= 15) last.xEnd = x;
    else clusters.push({ xStart: x, xEnd: x });
  }
  return clusters.map((c) => ({
    xStart: c.xStart,
    xEnd: c.xEnd + 50,
    values: rows.map((r) => {
      const inCol = r.items.filter((i) => i.xLeft >= c.xStart - 1 && i.xLeft <= c.xEnd + 50);
      return inCol.map((i) => i.str).join(' ').trim();
    }),
  }));
}

function fractionMatching(values: string[], re: RegExp): number {
  if (values.length === 0) return 0;
  const matches = values.filter((v) => re.test(v.trim())).length;
  return matches / values.length;
}

function inferColumnRoles(cols: ColumnCluster[]): Array<{ xStart: number; xEnd: number; role: ColumnRole }> | null {
  // Date column: fraction of values matching DATE_RE >= 0.8
  let dateIdx = -1;
  let bestDate = 0;
  cols.forEach((c, idx) => {
    const f = fractionMatching(c.values, DATE_RE);
    if (f >= 0.8 && f > bestDate) { bestDate = f; dateIdx = idx; }
  });
  if (dateIdx === -1) return null;

  // Amount column(s): fraction matching AMOUNT_RE >= 0.6 (allows blanks in débit/crédit pair)
  const amountCandidates: number[] = [];
  cols.forEach((c, idx) => {
    if (idx === dateIdx) return;
    const nonEmpty = c.values.filter((v) => v !== '').length;
    if (nonEmpty === 0) return;
    const matches = c.values.filter((v) => AMOUNT_RE.test(v)).length;
    if (matches / Math.max(nonEmpty, 1) >= 0.6) amountCandidates.push(idx);
  });

  let signedIdx = -1;
  let debitIdx = -1, creditIdx = -1;
  if (amountCandidates.length === 1) {
    signedIdx = amountCandidates[0]!;
  } else if (amountCandidates.length >= 2) {
    // Pick the two whose populated rows are mutually exclusive (débit/crédit pair).
    const pairs: Array<[number, number, number]> = [];     // [i, j, exclusivity score]
    for (let i = 0; i < amountCandidates.length; i++) {
      for (let j = i + 1; j < amountCandidates.length; j++) {
        const a = cols[amountCandidates[i]!]!.values;
        const b = cols[amountCandidates[j]!]!.values;
        let both = 0, either = 0;
        for (let k = 0; k < a.length; k++) {
          const pa = AMOUNT_RE.test(a[k] ?? '');
          const pb = AMOUNT_RE.test(b[k] ?? '');
          if (pa && pb) both++;
          if (pa || pb) either++;
        }
        const exclusivity = either === 0 ? 0 : 1 - both / either;
        pairs.push([amountCandidates[i]!, amountCandidates[j]!, exclusivity]);
      }
    }
    pairs.sort((p, q) => q[2] - p[2]);
    const best = pairs[0]!;
    if (best[2] >= 0.8) {
      // débit is the leftmost of the pair
      [debitIdx, creditIdx] = best[0]! < best[1]! ? [best[0]!, best[1]!] : [best[1]!, best[0]!];
    } else {
      signedIdx = amountCandidates[0]!;
    }
  } else {
    return null;
  }

  // Description = widest remaining column
  const used = new Set([dateIdx, signedIdx, debitIdx, creditIdx].filter((i) => i >= 0));
  let descIdx = -1;
  let widest = 0;
  cols.forEach((c, idx) => {
    if (used.has(idx)) return;
    const w = c.xEnd - c.xStart;
    if (w > widest) { widest = w; descIdx = idx; }
  });
  if (descIdx === -1) return null;

  const out: Array<{ xStart: number; xEnd: number; role: ColumnRole }> = [];
  cols.forEach((c, idx) => {
    let role: ColumnRole = 'ignore';
    if (idx === dateIdx) role = 'date';
    else if (idx === signedIdx) role = 'amountSigned';
    else if (idx === debitIdx) role = 'debit';
    else if (idx === creditIdx) role = 'credit';
    else if (idx === descIdx) role = 'description';
    out.push({ xStart: c.xStart, xEnd: c.xEnd, role });
  });
  return out;
}

function findRowsStartY(rows: Row[], dateColIdx: number): number {
  // First row whose date-column value parses as a date.
  for (const r of rows) {
    const text = r.items[dateColIdx]?.str ?? '';
    if (DATE_RE.test(text.trim())) return r.yTop - 1;
  }
  return rows[0]?.yTop ?? 0;
}

function valueInColumn(row: Row, col: { xStart: number; xEnd: number }): string {
  return row.items
    .filter((i) => i.xLeft >= col.xStart - 1 && i.xLeft <= col.xEnd + 50)
    .map((i) => i.str)
    .join(' ')
    .trim();
}

function extractRows(
  rows: Row[],
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>,
): { parsed: ParsedTransaction[]; skipped: Array<{ rowText: string; reason: string }> } {
  const dateCol = columns.find((c) => c.role === 'date')!;
  const descCol = columns.find((c) => c.role === 'description')!;
  const signedCol = columns.find((c) => c.role === 'amountSigned');
  const debitCol = columns.find((c) => c.role === 'debit');
  const creditCol = columns.find((c) => c.role === 'credit');

  const parsed: ParsedTransaction[] = [];
  const skipped: Array<{ rowText: string; reason: string }> = [];

  for (const r of rows) {
    const rowText = r.items.map((i) => i.str).join(' ');
    const dateRaw = valueInColumn(r, dateCol);
    if (!dateRaw) continue;
    const date = tryParseFrenchDate(dateRaw);
    if (!date) { skipped.push({ rowText, reason: `unparseable date "${dateRaw}"` }); continue; }

    let amount: string | null = null;
    if (signedCol) {
      const raw = valueInColumn(r, signedCol);
      amount = tryParseFrenchAmount(raw);
      if (!amount) { skipped.push({ rowText, reason: `unparseable amount "${raw}"` }); continue; }
    } else if (debitCol && creditCol) {
      const d = valueInColumn(r, debitCol);
      const c = valueInColumn(r, creditCol);
      if (d) {
        const n = tryParseFrenchAmount(d);
        if (!n) { skipped.push({ rowText, reason: `unparseable debit "${d}"` }); continue; }
        amount = n.startsWith('-') ? n : `-${n}`;
      } else if (c) {
        const n = tryParseFrenchAmount(c);
        if (!n) { skipped.push({ rowText, reason: `unparseable credit "${c}"` }); continue; }
        amount = n;
      } else {
        continue;       // neither populated → row is a separator/blank
      }
    } else {
      throw new Error('extractRows: invalid column set');
    }

    const rawLabel = valueInColumn(r, descCol);
    parsed.push({ date, amount, rawLabel, memo: null, fitid: null });
  }
  return { parsed, skipped };
}

export function runHeuristic(pages: PdfPageText[]): HeuristicResult {
  if (pages.length === 0 || pages[0]!.items.length === 0) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }

  // Cluster rows + columns on page 1 to discover the template.
  const firstPageRows = clusterRows(pages[0]!.items);
  if (firstPageRows.length < 2) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }
  const columnsRaw = clusterColumns(firstPageRows);
  const columns = inferColumnRoles(columnsRaw);
  if (!columns) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }

  // Find the table top — first row with a parseable date in the date column.
  const dateColIdx = columnsRaw.findIndex(
    (_, i) => columns[i]?.role === 'date',
  );
  const rowsStartY = findRowsStartY(firstPageRows, dateColIdx);

  // Decide whether the table repeats per page: if pages > 1 and any later page
  // has rows whose date-column values parse, mark repeating.
  let tableRepeatsPerPage = false;
  if (pages.length > 1) {
    for (let p = 1; p < pages.length; p++) {
      const laterRows = clusterRows(pages[p]!.items);
      const dates = laterRows.map((r) => valueInColumn(r, columns[dateColIdx]!));
      if (dates.some((d) => DATE_RE.test(d))) { tableRepeatsPerPage = true; break; }
    }
  }

  // Extract rows from every page (page 1: from rowsStartY down; later pages: top-down).
  let allParsed: ParsedTransaction[] = [];
  let allSkipped: Array<{ rowText: string; reason: string }> = [];
  let totalConsidered = 0;
  for (let p = 0; p < pages.length; p++) {
    const pageRows = clusterRows(pages[p]!.items);
    const dataRows = p === 0 ? pageRows.filter((r) => r.yTop >= rowsStartY) : pageRows;
    if (!tableRepeatsPerPage && p > 0) continue;

    // Only rows that have *something* in the date column count toward the denominator,
    // so totals like "Solde au 31/01/2026" can sit below without dragging confidence down.
    const candidate = dataRows.filter((r) => {
      const v = valueInColumn(r, columns[dateColIdx]!);
      return v !== '';
    });
    const { parsed, skipped } = extractRows(candidate, columns);
    allParsed = allParsed.concat(parsed);
    allSkipped = allSkipped.concat(skipped);
    totalConsidered += candidate.length;
  }

  const confidence = totalConsidered === 0 ? 0 : allParsed.length / totalConsidered;

  const tableZone: ZoneRect = {
    page: 0,
    x: Math.min(...columnsRaw.map((c) => c.xStart)),
    y: rowsStartY,
    w: Math.max(...columnsRaw.map((c) => c.xEnd)) - Math.min(...columnsRaw.map((c) => c.xStart)),
    h: pages[0]!.heightPt - rowsStartY,
  };
  const headerZone: ZoneRect = {
    page: 0, x: 0, y: 0, w: pages[0]!.widthPt, h: pages[0]!.heightPt * 0.15,
  };
  const zones: TemplateZones = {
    headerZone,
    tableZone,
    tableRepeatsPerPage,
    columns,
    rowsStartY,
  };

  return { zones, rows: allParsed, confidence, skippedRows: allSkipped };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-heuristic`

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/imports/french-numerics.ts \
        backend/src/domain/imports/csv-parser.ts \
        backend/src/domain/imports/pdf/heuristic.ts \
        backend/tests/imports/pdf-heuristic.test.ts
git commit -m "feat(pdf-import): heuristic row/column extractor with confidence score"
```

---

## Task 5: Template-apply function

**Files:**
- Create: `backend/src/domain/imports/pdf/template-apply.ts`
- Test: `backend/tests/imports/pdf-template-apply.test.ts`

**Interfaces:**
- Consumes: `PdfPageText` from `text-extract.ts`; `TemplateZones`, `ColumnRole` from `zones.ts`; `tryParseFrenchDate`, `tryParseFrenchAmount` from `french-numerics.ts`; `ParsedTransaction` from `ofx-parser.ts`.
- Produces: `applyTemplate(pages: PdfPageText[], zones: TemplateZones): ApplyResult`.

- [ ] **Step 1: Write the failing test**

`backend/tests/imports/pdf-template-apply.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import type { TemplateZones } from '../../src/domain/imports/pdf/zones.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

const zones: TemplateZones = {
  headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
  tableZone: { page: 0, x: 30, y: 200, w: 540, h: 600 },
  tableRepeatsPerPage: false,
  columns: [
    { xStart: 30, xEnd: 110, role: 'date' },
    { xStart: 110, xEnd: 470, role: 'description' },
    { xStart: 470, xEnd: 570, role: 'amountSigned' },
  ],
  rowsStartY: 210,
};

describe('applyTemplate', () => {
  it('extracts rows defined by zones', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 240), item('VIR LOYER',     120, 240), item('-850,00', 480, 240),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' });
    expect(r.skippedRows).toHaveLength(0);
  });

  it('skips unparseable rows but keeps a record of them', () => {
    const pages = [page([
      item('15/01/2026', 40, 220), item('OK',  120, 220), item('-10,00', 480, 220),
      item('16/13/2026', 40, 240), item('BAD DATE', 120, 240), item('-1,00', 480, 240),
      item('17/01/2026', 40, 260), item('GOOD', 120, 260), item('-2,00',  480, 260),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(2);
    expect(r.skippedRows).toHaveLength(1);
    expect(r.skippedRows[0]!.reason).toMatch(/date/);
  });

  it('honors tableRepeatsPerPage=false (later pages ignored)', () => {
    const pages = [
      page([item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220)]),
      page([item('15/02/2026', 40, 220), item('B', 120, 220), item('-2,00', 480, 220)]),
    ];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(1);
  });

  it('honors tableRepeatsPerPage=true', () => {
    const pages = [
      page([item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220)]),
      page([item('15/02/2026', 40, 220), item('B', 120, 220), item('-2,00', 480, 220)]),
    ];
    const r = applyTemplate(pages, { ...zones, tableRepeatsPerPage: true });
    expect(r.rows).toHaveLength(2);
  });

  it('handles debit/credit column pair', () => {
    const dcZones: TemplateZones = {
      ...zones,
      columns: [
        { xStart: 30, xEnd: 110, role: 'date' },
        { xStart: 110, xEnd: 380, role: 'description' },
        { xStart: 380, xEnd: 470, role: 'debit' },
        { xStart: 470, xEnd: 570, role: 'credit' },
      ],
    };
    const pages = [page([
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 240), item('SALAIRE',       120, 240),                            item('1 200,00', 500, 240),
    ])];
    const r = applyTemplate(pages, dcZones);
    expect(r.rows.map((row) => row.amount)).toEqual(['-42.30', '1200.00']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-template-apply`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `template-apply.ts`**

`backend/src/domain/imports/pdf/template-apply.ts`:

```ts
import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones, ColumnRole } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';

export interface ApplyResult {
  rows: ParsedTransaction[];
  skippedRows: Array<{ rowText: string; reason: string }>;
}

const ROW_Y_TOLERANCE_PT = 2;

function clusterRows(items: PdfTextItem[]): Array<{ yTop: number; items: PdfTextItem[] }> {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop);
  const rows: Array<{ yTop: number; items: PdfTextItem[] }> = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last.yTop) <= ROW_Y_TOLERANCE_PT) last.items.push(it);
    else rows.push({ yTop: it.yTop, items: [it] });
  }
  return rows;
}

function valueIn(row: { items: PdfTextItem[] }, xStart: number, xEnd: number): string {
  return row.items
    .filter((i) => i.xLeft >= xStart - 1 && i.xLeft <= xEnd + 50)
    .sort((a, b) => a.xLeft - b.xLeft)
    .map((i) => i.str)
    .join(' ')
    .trim();
}

export function applyTemplate(pages: PdfPageText[], zones: TemplateZones): ApplyResult {
  const dateCol = zones.columns.find((c) => c.role === 'date');
  const descCol = zones.columns.find((c) => c.role === 'description');
  const signedCol = zones.columns.find((c) => c.role === 'amountSigned');
  const debitCol = zones.columns.find((c) => c.role === 'debit');
  const creditCol = zones.columns.find((c) => c.role === 'credit');
  if (!dateCol || !descCol) throw new Error('template: missing date/description column');

  const rows: ParsedTransaction[] = [];
  const skipped: Array<{ rowText: string; reason: string }> = [];

  for (let p = 0; p < pages.length; p++) {
    if (p > 0 && !zones.tableRepeatsPerPage) break;
    const page = pages[p]!;
    const tableItems = page.items.filter((i) =>
      i.xLeft >= zones.tableZone.x - 1 &&
      i.xLeft <= zones.tableZone.x + zones.tableZone.w &&
      i.yTop >= (p === 0 ? zones.rowsStartY : 0) &&
      i.yTop <= page.heightPt,
    );
    const rowClusters = clusterRows(tableItems);
    for (const r of rowClusters) {
      const dateRaw = valueIn(r, dateCol.xStart, dateCol.xEnd);
      if (!dateRaw) continue;
      const rowText = r.items.map((i) => i.str).join(' ');
      const date = tryParseFrenchDate(dateRaw);
      if (!date) { skipped.push({ rowText, reason: `unparseable date "${dateRaw}"` }); continue; }

      let amount: string | null = null;
      if (signedCol) {
        const raw = valueIn(r, signedCol.xStart, signedCol.xEnd);
        amount = tryParseFrenchAmount(raw);
        if (!amount) { skipped.push({ rowText, reason: `unparseable amount "${raw}"` }); continue; }
      } else if (debitCol && creditCol) {
        const d = valueIn(r, debitCol.xStart, debitCol.xEnd);
        const c = valueIn(r, creditCol.xStart, creditCol.xEnd);
        if (d) {
          const n = tryParseFrenchAmount(d);
          if (!n) { skipped.push({ rowText, reason: `unparseable debit "${d}"` }); continue; }
          amount = n.startsWith('-') ? n : `-${n}`;
        } else if (c) {
          const n = tryParseFrenchAmount(c);
          if (!n) { skipped.push({ rowText, reason: `unparseable credit "${c}"` }); continue; }
          amount = n;
        } else {
          continue;
        }
      } else {
        throw new Error('template: invalid amount column configuration');
      }

      const rawLabel = valueIn(r, descCol.xStart, descCol.xEnd);
      rows.push({ date, amount, rawLabel, memo: null, fitid: null });
    }
  }
  return { rows, skippedRows: skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-template-apply`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/imports/pdf/template-apply.ts \
        backend/tests/imports/pdf-template-apply.test.ts
git commit -m "feat(pdf-import): apply learned template zones to extract rows"
```

---

## Task 6: Heuristic ↔ template-apply round-trip

**Files:**
- Test: `backend/tests/imports/pdf-roundtrip.test.ts`

**Interfaces:**
- Consumes: `runHeuristic`, `applyTemplate`.
- Produces: nothing new — verifies the two paths agree.

- [ ] **Step 1: Write the test**

`backend/tests/imports/pdf-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('heuristic ↔ template-apply round trip', () => {
  it('signed-amount table: heuristic output equals template-apply output', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 235), item('VIR LOYER',     120, 235), item('-850,00', 480, 235),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250), item('1 200,00', 480, 250),
    ])];
    const h = runHeuristic(pages);
    expect(h.confidence).toBeGreaterThanOrEqual(0.9);
    const t = applyTemplate(pages, h.zones!);
    expect(t.rows).toEqual(h.rows);
  });

  it('débit/crédit table: round trip stable', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Débit', 400, 200), item('Crédit', 500, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 240), item('SALAIRE',       120, 240),                            item('1 200,00', 500, 240),
    ])];
    const h = runHeuristic(pages);
    const t = applyTemplate(pages, h.zones!);
    expect(t.rows).toEqual(h.rows);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd backend && npm test -- pdf-roundtrip`

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/imports/pdf-roundtrip.test.ts
git commit -m "test(pdf-import): heuristic ↔ template-apply parity"
```

---

## Task 7: Page renderer (PDF → PNG)

**Files:**
- Create: `backend/src/domain/imports/pdf/render.ts`
- Test: `backend/tests/imports/pdf-render.test.ts`
- Modify: `backend/package.json` (add `@napi-rs/canvas`)

**Interfaces:**
- Consumes: pdfjs from `text-extract.ts`'s import path (we re-import here for the render API).
- Produces: `renderPagesToPng(buf: Buffer): Promise<RenderedPage[]>` and the type `RenderedPage = { pageIndex: number; pngBase64: string; widthPt: number; heightPt: number }`.

- [ ] **Step 1: Add canvas dep**

Run:

```bash
cd backend && npm install @napi-rs/canvas@0.1.55
```

- [ ] **Step 2: Write the failing test**

`backend/tests/imports/pdf-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { renderPagesToPng } from '../../src/domain/imports/pdf/render.js';

function buildTwoPagePdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text('Page One', 100, 100);
    doc.addPage();
    doc.fontSize(20).text('Page Two', 100, 100);
    doc.end();
  });
}

describe('renderPagesToPng', () => {
  it('produces one PNG per page at 150 DPI', async () => {
    const buf = await buildTwoPagePdf();
    const pages = await renderPagesToPng(buf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.pageIndex).toBe(0);
    expect(pages[0]!.widthPt).toBeCloseTo(595, 0);     // A4 width in points
    expect(pages[0]!.pngBase64.length).toBeGreaterThan(1000);
    expect(pages[0]!.pngBase64.startsWith('iVBORw0KGgo')).toBe(true);   // PNG magic in base64
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-render`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `render.ts`**

`backend/src/domain/imports/pdf/render.ts`:

```ts
import { createCanvas } from '@napi-rs/canvas';

export interface RenderedPage {
  pageIndex: number;
  pngBase64: string;
  widthPt: number;
  heightPt: number;
}

const TARGET_DPI = 150;
const SCALE = TARGET_DPI / 72;       // PDF user space is 72dpi

let pdfjsModule: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
async function loadPdfjs() {
  if (!pdfjsModule) pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsModule;
}

export async function renderPagesToPng(buf: Buffer): Promise<RenderedPage[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  try {
    const out: RenderedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewportBase = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      // pdfjs needs a canvas factory shape compatible with what it expects.
      // The @napi-rs/canvas context already implements the 2D Canvas API.
      await page.render({ canvasContext: ctx as any, viewport }).promise;
      const pngBuf = await canvas.encode('png');
      out.push({
        pageIndex: i - 1,
        pngBase64: pngBuf.toString('base64'),
        widthPt: viewportBase.width,
        heightPt: viewportBase.height,
      });
    }
    return out;
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-render`

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json \
        backend/src/domain/imports/pdf/render.ts \
        backend/tests/imports/pdf-render.test.ts
git commit -m "feat(pdf-import): render PDF pages to base64 PNG at 150 DPI"
```

---

## Task 8: PDF import orchestrator

**Files:**
- Create: `backend/src/domain/imports/pdf/index.ts`
- Test: `backend/tests/imports/pdf-orchestrator.test.ts`

**Interfaces:**
- Consumes: `extractText`, `fingerprintHeader`, `runHeuristic`, `applyTemplate`, `renderPagesToPng`; Drizzle tables `pdfStatementTemplates`, `pdfImportDrafts`; `runImport` from `import-service.ts` (we feed it `ParsedTransaction[]` plus the `'pdf'` format).
- Produces: `importPdf(opts: { filename: string; accountId: number; buffer: Buffer }): Promise<ImportPdfResult>` and `applyTemplateAndImport(opts: { draftId: number; label: string; zones: TemplateZones }): Promise<ImportPdfImportedResult>` (defined inline).

Note: `runImport` is currently coupled to OFX/CSV via its internal `parseFile`. We need to either (a) refactor it to accept already-parsed rows, or (b) duplicate the body. Option (a) is cleaner — do that in this task.

- [ ] **Step 1: Refactor `import-service.ts` to accept pre-parsed rows**

In `backend/src/domain/imports/import-service.ts`, change the signature of `runImport` to:

```ts
export async function runImport(opts: {
  filename: string;
  accountId: number;
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
}): Promise<ImportResult> {
  const parsed = opts.prepared ?? parseFile(opts.buffer!, opts.format);
  // ... rest unchanged
}
```

Also widen `ImportFormat`:

```ts
export type ImportFormat = 'ofx' | 'csv' | 'pdf';
```

And widen `parseFile` to throw for `'pdf'`:

```ts
function parseFile(buf: Buffer, format: ImportFormat): ParsedTransaction[] {
  if (format === 'ofx') return parseOfx(buf);
  if (format === 'csv') return parseFrenchCsv(buf);
  throw new Error(`parseFile: format ${format} not handled here`);
}
```

Adjust `inferFormat`:

```ts
export function inferFormat(filename: string): ImportFormat | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return null;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd backend && npm test`

Expected: all existing tests still green.

- [ ] **Step 3: Write the failing orchestrator test**

`backend/tests/imports/pdf-orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import PDFDocument from 'pdfkit';
import { db } from '../../src/db/client.js';
import { sql } from 'drizzle-orm';
import { importPdf, applyTemplateAndImport } from '../../src/domain/imports/pdf/index.js';
import { accounts, pdfImportDrafts, pdfStatementTemplates } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function buildStatementPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica').fontSize(10);
    doc.text('BANQUE EXAMPLE',                     40,  30);
    doc.text("Relevé n°12345",                      40,  60);
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
}

let accountId: number;

beforeAll(async () => {
  const [acc] = await db.insert(accounts).values({
    name: 'PDF Test Account', type: 'checking', openingDate: '2025-01-01',
  }).returning();
  accountId = acc!.id;
});

afterEach(async () => {
  await db.delete(pdfImportDrafts);
  await db.delete(pdfStatementTemplates);
});

describe('importPdf', () => {
  it('auto-imports on high heuristic confidence and silently saves the template', async () => {
    const buf = await buildStatementPdf();
    const r = await importPdf({ filename: 'releve.pdf', accountId, buffer: buf });
    expect(r.kind).toBe('imported');
    if (r.kind !== 'imported') return;
    expect(r.result.insertedCount).toBe(2);
    const tpls = await db.select().from(pdfStatementTemplates);
    expect(tpls).toHaveLength(1);
    expect(tpls[0]!.source).toBe('heuristic');
  });

  it('reuses an existing template on a second import', async () => {
    const buf = await buildStatementPdf();
    await importPdf({ filename: 'releve.pdf', accountId, buffer: buf });
    const r = await importPdf({ filename: 'releve.pdf', accountId, buffer: buf });
    expect(r.kind).toBe('imported');
    if (r.kind !== 'imported') return;
    // Same dedup keys → 0 inserted on the second pass.
    expect(r.result.insertedCount).toBe(0);
    expect(r.result.dedupSkipped).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-orchestrator`

Expected: FAIL — `importPdf` not exported.

- [ ] **Step 5: Implement `pdf/index.ts`**

`backend/src/domain/imports/pdf/index.ts`:

```ts
import { db } from '../../../db/client.js';
import { pdfStatementTemplates, pdfImportDrafts } from '../../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { extractText, type PdfTextItem, type PdfPageText } from './text-extract.js';
import { fingerprintHeader } from './fingerprint.js';
import { runHeuristic } from './heuristic.js';
import { applyTemplate } from './template-apply.js';
import { renderPagesToPng, type RenderedPage } from './render.js';
import { validateZones, type TemplateZones } from './zones.js';
import { runImport, type ImportResult } from '../import-service.js';

const HEURISTIC_AUTO_THRESHOLD = 0.9;
const HEURISTIC_SUGGEST_THRESHOLD = 0.5;

export type ImportPdfResult =
  | {
      kind: 'imported';
      result: ImportResult;
      skippedRows: Array<{ rowText: string; reason: string }>;
    }
  | {
      kind: 'needs_template';
      draftId: number;
      fingerprint: string;
      pages: RenderedPage[];
      textItems: PdfTextItem[];
      suggestedZones: TemplateZones | null;
      reason: 'no_text_layer' | 'low_confidence';
    };

function flattenItems(pages: PdfPageText[]): PdfTextItem[] {
  return pages.flatMap((p) => p.items);
}

export async function importPdf(opts: {
  filename: string;
  accountId: number;
  buffer: Buffer;
}): Promise<ImportPdfResult> {
  const pages = await extractText(opts.buffer);
  const noText = pages.every((p) => p.items.length === 0);
  const fingerprint = noText ? '' : fingerprintHeader(pages[0]!);

  // 1) Existing template? Apply it.
  if (fingerprint) {
    const [tpl] = await db
      .select()
      .from(pdfStatementTemplates)
      .where(eq(pdfStatementTemplates.fingerprint, fingerprint));
    if (tpl) {
      const { rows, skippedRows } = applyTemplate(pages, tpl.zones as TemplateZones);
      if (rows.length === 0) {
        const err = new Error('template_yielded_no_rows');
        (err as any).code = 'template_yielded_no_rows';
        throw err;
      }
      const result = await runImport({
        filename: opts.filename,
        accountId: opts.accountId,
        format: 'pdf',
        prepared: rows,
      });
      return { kind: 'imported', result, skippedRows };
    }
  }

  // 2) No template — try heuristic.
  if (noText) {
    return await parkDraft(opts, pages, fingerprint, null, 'no_text_layer');
  }
  const h = runHeuristic(pages);
  if (h.confidence >= HEURISTIC_AUTO_THRESHOLD && h.zones) {
    validateZones(h.zones);
    await db.insert(pdfStatementTemplates)
      .values({
        fingerprint,
        label: opts.filename,
        zones: h.zones,
        source: 'heuristic',
      })
      .onConflictDoNothing({ target: pdfStatementTemplates.fingerprint });
    const result = await runImport({
      filename: opts.filename,
      accountId: opts.accountId,
      format: 'pdf',
      prepared: h.rows,
    });
    return { kind: 'imported', result, skippedRows: h.skippedRows };
  }
  const suggested = h.confidence >= HEURISTIC_SUGGEST_THRESHOLD ? h.zones : null;
  return await parkDraft(opts, pages, fingerprint, suggested, 'low_confidence');
}

async function parkDraft(
  opts: { accountId: number; buffer: Buffer },
  pages: PdfPageText[],
  fingerprint: string,
  suggestedZones: TemplateZones | null,
  reason: 'no_text_layer' | 'low_confidence',
): Promise<ImportPdfResult> {
  const rendered = await renderPagesToPng(opts.buffer);
  const [draft] = await db.insert(pdfImportDrafts).values({
    accountId: opts.accountId,
    pdfBytes: opts.buffer.toString('base64'),
    textItems: flattenItems(pages),
    fingerprint,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();
  return {
    kind: 'needs_template',
    draftId: draft!.id,
    fingerprint,
    pages: rendered,
    textItems: flattenItems(pages),
    suggestedZones,
    reason,
  };
}

export interface ApplyTemplateImportedResult {
  result: ImportResult;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export async function applyTemplateAndImport(opts: {
  draftId: number;
  label: string;
  zones: TemplateZones;
}): Promise<ApplyTemplateImportedResult> {
  validateZones(opts.zones);
  const [draft] = await db.select().from(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  if (!draft) {
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  if (draft.expiresAt < new Date()) {
    await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  const buf = Buffer.from(draft.pdfBytes as string, 'base64');
  const pages = await extractText(buf);
  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  if (rows.length === 0) {
    const err = new Error('template_yielded_no_rows');
    (err as any).code = 'template_yielded_no_rows';
    throw err;
  }
  await db.insert(pdfStatementTemplates).values({
    fingerprint: draft.fingerprint,
    label: opts.label,
    zones: opts.zones,
    source: 'interactive',
  }).onConflictDoUpdate({
    target: pdfStatementTemplates.fingerprint,
    set: { label: opts.label, zones: opts.zones, source: 'interactive', updatedAt: sql`now()` },
  });
  const result = await runImport({
    filename: opts.label,
    accountId: draft.accountId,
    format: 'pdf',
    prepared: rows,
  });
  await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  return { result, skippedRows };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-orchestrator`

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/imports/import-service.ts \
        backend/src/domain/imports/pdf/index.ts \
        backend/tests/imports/pdf-orchestrator.test.ts
git commit -m "feat(pdf-import): orchestrator — fingerprint, heuristic, draft fallback"
```

---

## Task 9: HTTP route wiring

**Files:**
- Modify: `backend/src/http/routes/imports.ts`
- Test: `backend/tests/imports/pdf-routes.test.ts`

**Interfaces:**
- Consumes: `importPdf`, `applyTemplateAndImport` from `pdf/index.ts`.
- Produces: `POST /api/imports` accepts `.pdf`; `POST /api/imports/pdf/templates` finalizes a draft.

- [ ] **Step 1: Write the failing route test**

`backend/tests/imports/pdf-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../helpers/build-app.js';   // assume this helper exists; if not, see step 2
import PDFDocument from 'pdfkit';
import FormData from 'form-data';

// ... (similar setup as pdf-orchestrator.test.ts: login, create account)
// Two scenarios:
//   1. Auto-import path returns 201 with { kind: 'imported', result: {...} }.
//   2. needs_template path returns 200 with { kind: 'needs_template', draftId, pages, textItems }
//      then POST /api/imports/pdf/templates returns 201 with { result, skippedRows }.
```

If a build-app helper does not yet exist in tests, create `backend/tests/helpers/build-app.ts`:

```ts
import { build } from '../../src/server.js';
export async function buildApp() {
  return await build({ logger: false });
}
```

(If `server.ts` does not export `build`, add a `build` export wrapping the current bootstrap.)

Full route test:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../helpers/build-app.js';
import PDFDocument from 'pdfkit';
import { db } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let cookie: string;
let accountId: number;

async function buildPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica').fontSize(10);
    doc.text('BANQUE EXAMPLE', 40, 30);
    doc.text('Date',    40,  200);
    doc.text('Libellé', 120, 200);
    doc.text('Montant', 480, 200);
    doc.text('15/01/2026', 40, 220);
    doc.text('CB CARREFOUR', 120, 220);
    doc.text('-42,30', 480, 220);
    doc.text('17/01/2026', 40, 240);
    doc.text('SALAIRE', 120, 240);
    doc.text('1 200,00', 480, 240);
    doc.end();
  });
}

beforeAll(async () => {
  app = await buildApp();
  // assumes onboarding endpoint is open; create user + login to get cookie
  await app.inject({ method: 'POST', url: '/api/onboarding/create',
    payload: { username: 'pdftest', password: 'pdf-password-1234' } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login',
    payload: { username: 'pdftest', password: 'pdf-password-1234' } });
  cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  const [acc] = await db.insert(accounts).values({
    name: 'PDF Routes Test', type: 'checking', openingDate: '2025-01-01',
  }).returning();
  accountId = acc!.id;
});

describe('POST /api/imports with .pdf', () => {
  it('auto-imports when heuristic confidence is high', async () => {
    const buf = await buildPdf();
    const form = new FormData();
    form.append('file', buf, { filename: 'releve.pdf', contentType: 'application/pdf' });
    const res = await app.inject({
      method: 'POST', url: `/api/imports?accountId=${accountId}`,
      headers: { cookie, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.kind).toBe('imported');
    expect(body.result.insertedCount).toBe(2);
  });
});
```

- [ ] **Step 2: Modify the imports route**

Replace `backend/src/http/routes/imports.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports } from '../../db/schema.js';
import {
  inferFormat,
  resolveAccountFromFilename,
  runImport,
} from '../../domain/imports/import-service.js';
import { importPdf, applyTemplateAndImport } from '../../domain/imports/pdf/index.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

export async function importsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/imports', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, or .pdf)' });
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
      accountId = await resolveAccountFromFilename(filename);
    }
    if (!accountId) {
      return reply.code(400).send({
        error: 'cannot determine target account; pass ?accountId=N or configure a filename pattern',
      });
    }

    if (format === 'pdf') {
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return reply.code(413).send({ code: 'pdf_too_large', error: 'PDF exceeds 10MB limit' });
      }
      try {
        const r = await importPdf({ filename, accountId, buffer });
        if (r.kind === 'imported') return reply.code(201).send(r);
        return reply.code(200).send(r);
      } catch (err: any) {
        if (err?.code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
        if (err?.code === 'template_yielded_no_rows') {
          return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'saved template did not match this PDF; retrain via /api/pdf-templates' });
        }
        app.log.error({ err, filename }, 'pdf import failed');
        return reply.code(400).send({ error: 'pdf import failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const result = await runImport({ filename, accountId, format, buffer });
      return reply.code(201).send(result);
    } catch (err) {
      app.log.error({ err, filename }, 'import failed');
      return reply.code(400).send({ error: 'import failed', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/imports/pdf/templates', async (req, reply) => {
    const body = req.body as { draftId?: number; label?: string; zones?: TemplateZones };
    if (!body?.draftId || !body.label || !body.zones) {
      return reply.code(400).send({ error: 'draftId, label, and zones are required' });
    }
    try {
      const r = await applyTemplateAndImport({ draftId: body.draftId, label: body.label, zones: body.zones });
      return reply.code(201).send(r);
    } catch (err: any) {
      if (err?.code === 'draft_expired') return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      if (err?.code === 'template_yielded_no_rows') return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'zones produced 0 rows' });
      app.log.error({ err }, 'apply template failed');
      return reply.code(400).send({ error: 'apply template failed', message: err?.message ?? String(err) });
    }
  });

  app.get('/api/imports', async () => {
    const rows = await db.select().from(fileImports).orderBy(desc(fileImports.importedAt)).limit(100);
    return { imports: rows };
  });

  app.get('/api/imports/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const [row] = await db.select().from(fileImports).where(eq(fileImports.id, id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { fileImport: row };
  });
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd backend && npm install --save-dev form-data && npm test -- pdf-routes`

Expected: route test passes.

- [ ] **Step 4: Commit**

```bash
git add backend/src/http/routes/imports.ts \
        backend/tests/imports/pdf-routes.test.ts \
        backend/tests/helpers/build-app.ts \
        backend/package.json backend/package-lock.json
git commit -m "feat(pdf-import): wire .pdf into POST /api/imports + submit-zones endpoint"
```

---

## Task 10: Draft sweeper

**Files:**
- Create: `backend/src/domain/imports/pdf/draft-sweeper.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/imports/pdf-draft-sweeper.test.ts`

**Interfaces:**
- Consumes: `pdfImportDrafts` from schema.
- Produces: `sweepExpiredDrafts(): Promise<number>` returns count deleted; `startDraftSweeper(app: FastifyInstance): void` registers an hourly timer that uses `setInterval` and is cleared on `app.addHook('onClose')`.

- [ ] **Step 1: Write the failing test**

`backend/tests/imports/pdf-draft-sweeper.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/client.js';
import { accounts, pdfImportDrafts } from '../../src/db/schema.js';
import { sweepExpiredDrafts } from '../../src/domain/imports/pdf/draft-sweeper.js';

describe('sweepExpiredDrafts', () => {
  let accountId: number;
  beforeEach(async () => {
    await db.delete(pdfImportDrafts);
    const [acc] = await db.insert(accounts).values({
      name: 'Sweeper Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;
  });

  it('deletes drafts whose expires_at is in the past', async () => {
    await db.insert(pdfImportDrafts).values([
      { accountId, pdfBytes: 'x', textItems: [], fingerprint: 'fp1',
        expiresAt: new Date(Date.now() - 1000) },
      { accountId, pdfBytes: 'y', textItems: [], fingerprint: 'fp2',
        expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const n = await sweepExpiredDrafts();
    expect(n).toBe(1);
    const remaining = await db.select().from(pdfImportDrafts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.fingerprint).toBe('fp2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-draft-sweeper`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `draft-sweeper.ts`**

`backend/src/domain/imports/pdf/draft-sweeper.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredDrafts(): Promise<number> {
  const deleted = await db
    .delete(pdfImportDrafts)
    .where(lt(pdfImportDrafts.expiresAt, new Date()))
    .returning({ id: pdfImportDrafts.id });
  return deleted.length;
}

export function startDraftSweeper(app: FastifyInstance): void {
  void sweepExpiredDrafts().catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  const handle = setInterval(() => {
    void sweepExpiredDrafts().catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  }, SWEEP_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => clearInterval(handle));
}
```

- [ ] **Step 4: Wire into server.ts**

In `backend/src/server.ts`, after routes are registered, call:

```ts
import { startDraftSweeper } from './domain/imports/pdf/draft-sweeper.js';
// ... after app.register(...) calls:
startDraftSweeper(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-draft-sweeper`

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/imports/pdf/draft-sweeper.ts \
        backend/src/server.ts \
        backend/tests/imports/pdf-draft-sweeper.test.ts
git commit -m "feat(pdf-import): hourly sweep of expired draft uploads"
```

---

## Task 11: Templates CRUD route

**Files:**
- Create: `backend/src/http/routes/pdf-templates.ts`
- Modify: `backend/src/server.ts` (register the new route)
- Test: `backend/tests/imports/pdf-templates-route.test.ts`

**Interfaces:**
- Consumes: `pdfStatementTemplates` table; `validateZones` from `zones.ts`.
- Produces: REST endpoints on `/api/pdf-templates`.

- [ ] **Step 1: Write the failing test**

`backend/tests/imports/pdf-templates-route.test.ts` (sketch, copy login/cookie setup from Task 9):

```ts
// ... beforeAll: build app, login, get cookie ...

describe('/api/pdf-templates', () => {
  it('lists, renames, and deletes templates', async () => {
    // Insert a template directly.
    const [tpl] = await db.insert(pdfStatementTemplates).values({
      fingerprint: 'abc123', label: 'Initial label',
      zones: { /* minimal valid zones */ }, source: 'interactive',
    }).returning();

    const list = await app.inject({ method: 'GET', url: '/api/pdf-templates', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().templates).toHaveLength(1);

    const rename = await app.inject({
      method: 'PUT', url: `/api/pdf-templates/${tpl!.id}`,
      headers: { cookie }, payload: { label: 'Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    const after = await db.select().from(pdfStatementTemplates).where(eq(pdfStatementTemplates.id, tpl!.id));
    expect(after[0]!.label).toBe('Renamed');

    const del = await app.inject({ method: 'DELETE', url: `/api/pdf-templates/${tpl!.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const final = await db.select().from(pdfStatementTemplates);
    expect(final).toHaveLength(0);
  });
});
```

Use a minimal valid zones literal in the insert:

```ts
const minimalZones = {
  headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
  tableZone: { page: 0, x: 30, y: 200, w: 540, h: 600 },
  tableRepeatsPerPage: false,
  rowsStartY: 210,
  columns: [
    { xStart: 30, xEnd: 110, role: 'date' },
    { xStart: 110, xEnd: 470, role: 'description' },
    { xStart: 470, xEnd: 570, role: 'amountSigned' },
  ],
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- pdf-templates-route`

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement `pdf-templates.ts`**

`backend/src/http/routes/pdf-templates.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pdfStatementTemplates } from '../../db/schema.js';
import { validateZones, type TemplateZones } from '../../domain/imports/pdf/zones.js';

export async function pdfTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/pdf-templates', async () => {
    const rows = await db
      .select({
        id: pdfStatementTemplates.id,
        fingerprint: pdfStatementTemplates.fingerprint,
        label: pdfStatementTemplates.label,
        source: pdfStatementTemplates.source,
        createdAt: pdfStatementTemplates.createdAt,
        updatedAt: pdfStatementTemplates.updatedAt,
      })
      .from(pdfStatementTemplates)
      .orderBy(desc(pdfStatementTemplates.updatedAt));
    return { templates: rows };
  });

  app.put('/api/pdf-templates/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const body = req.body as { label?: string; zones?: TemplateZones };
    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (typeof body.label === 'string' && body.label.trim()) updates.label = body.label.trim();
    if (body.zones) {
      validateZones(body.zones);
      updates.zones = body.zones;
    }
    if (Object.keys(updates).length === 1) {
      return reply.code(400).send({ error: 'nothing to update' });
    }
    const [row] = await db.update(pdfStatementTemplates).set(updates).where(eq(pdfStatementTemplates.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { template: row };
  });

  app.delete('/api/pdf-templates/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'invalid id' });
    const r = await db.delete(pdfStatementTemplates).where(eq(pdfStatementTemplates.id, id)).returning({ id: pdfStatementTemplates.id });
    if (r.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
```

In `backend/src/server.ts`:

```ts
import { pdfTemplatesRoutes } from './http/routes/pdf-templates.js';
// ... near other app.register calls:
await app.register(pdfTemplatesRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- pdf-templates-route`

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/pdf-templates.ts \
        backend/src/server.ts \
        backend/tests/imports/pdf-templates-route.test.ts
git commit -m "feat(pdf-import): CRUD for learned templates"
```

---

## Task 12: Frontend API client

**Files:**
- Create: `frontend/src/api/pdf-templates.ts`

**Interfaces:**
- Consumes: nothing (uses `fetch`).
- Produces: `submitPdf(file, accountId)`, `submitZones(draftId, label, zones)`, `listPdfTemplates()`, `renamePdfTemplate(id, label)`, `deletePdfTemplate(id)`, plus shared TS types `PdfImportResponse`, `TemplateZones`, `ColumnRole`.

- [ ] **Step 1: Create the file**

`frontend/src/api/pdf-templates.ts`:

```ts
export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect { page: number; x: number; y: number; w: number; h: number }

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

export interface PdfImportImported {
  kind: 'imported';
  result: { fileImportId: number; insertedCount: number; dedupSkipped: number; totalLines: number };
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export interface PdfTextItem {
  pageIndex: number; str: string;
  xLeft: number; yTop: number; width: number; height: number;
}

export interface PdfImportNeedsTemplate {
  kind: 'needs_template';
  draftId: number;
  fingerprint: string;
  pages: Array<{ pageIndex: number; pngBase64: string; widthPt: number; heightPt: number }>;
  textItems: PdfTextItem[];
  suggestedZones: TemplateZones | null;
  reason: 'no_text_layer' | 'low_confidence';
}

export type PdfImportResponse = PdfImportImported | PdfImportNeedsTemplate;

export async function submitPdf(file: File, accountId: number): Promise<PdfImportResponse> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`/api/imports?accountId=${accountId}`, {
    method: 'POST', body: form, credentials: 'include',
  });
  if (!r.ok && r.status !== 200) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? 'upload failed'), { code: body.code, status: r.status });
  }
  return await r.json();
}

export async function submitZones(draftId: number, label: string, zones: TemplateZones): Promise<PdfImportImported> {
  const r = await fetch('/api/imports/pdf/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ draftId, label, zones }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? 'apply failed'), { code: body.code, status: r.status });
  }
  const { result, skippedRows } = await r.json();
  return { kind: 'imported', result, skippedRows };
}

export interface PdfTemplateRow {
  id: number; fingerprint: string; label: string;
  source: 'heuristic' | 'interactive'; createdAt: string; updatedAt: string;
}

export async function listPdfTemplates(): Promise<PdfTemplateRow[]> {
  const r = await fetch('/api/pdf-templates', { credentials: 'include' });
  if (!r.ok) throw new Error('failed to list templates');
  return (await r.json()).templates;
}

export async function renamePdfTemplate(id: number, label: string): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ label }),
  });
  if (!r.ok) throw new Error('rename failed');
}

export async function deletePdfTemplate(id: number): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error('delete failed');
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/pdf-templates.ts
git commit -m "feat(pdf-import): frontend API client"
```

---

## Task 13: ZoneCanvas component

**Files:**
- Create: `frontend/src/components/PdfTemplateBuilder/ZoneCanvas.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<ZoneCanvas pngBase64 widthPt heightPt initialRect onChange />` — draws the PNG to a canvas, lets the user drag a rectangle, calls `onChange(rect)` in page-point coordinates (so callers don't need to know about display scaling).

- [ ] **Step 1: Create the component**

`frontend/src/components/PdfTemplateBuilder/ZoneCanvas.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

export interface PageRect { x: number; y: number; w: number; h: number }

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  initialRect: PageRect | null;
  displayMaxWidth?: number;
  onChange: (rect: PageRect) => void;
}

export function ZoneCanvas({
  pngBase64, widthPt, heightPt, initialRect, displayMaxWidth = 720, onChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<PageRect | null>(initialRect);
  const [drag, setDrag] = useState<{ x0: number; y0: number } | null>(null);
  const displayScale = Math.min(1, displayMaxWidth / widthPt);
  const displayWidth = widthPt * displayScale;
  const displayHeight = heightPt * displayScale;

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, cnv.width, cnv.height);
      ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      if (rect) {
        ctx.strokeStyle = '#0a84ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          rect.x * displayScale,
          rect.y * displayScale,
          rect.w * displayScale,
          rect.h * displayScale,
        );
        ctx.fillStyle = 'rgba(10,132,255,0.10)';
        ctx.fillRect(
          rect.x * displayScale,
          rect.y * displayScale,
          rect.w * displayScale,
          rect.h * displayScale,
        );
      }
    };
    img.src = `data:image/png;base64,${pngBase64}`;
  }, [pngBase64, rect, displayScale]);

  function toPagePt(ev: React.MouseEvent): { x: number; y: number } {
    const cnv = canvasRef.current!;
    const r = cnv.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / displayScale,
      y: (ev.clientY - r.top) / displayScale,
    };
  }

  function onMouseDown(ev: React.MouseEvent) {
    const p = toPagePt(ev);
    setDrag({ x0: p.x, y0: p.y });
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function onMouseMove(ev: React.MouseEvent) {
    if (!drag) return;
    const p = toPagePt(ev);
    const next: PageRect = {
      x: Math.min(drag.x0, p.x),
      y: Math.min(drag.y0, p.y),
      w: Math.abs(p.x - drag.x0),
      h: Math.abs(p.y - drag.y0),
    };
    setRect(next);
  }
  function onMouseUp() {
    if (drag && rect && rect.w > 5 && rect.h > 5) onChange(rect);
    setDrag(null);
  }

  return (
    <canvas
      ref={canvasRef}
      width={displayWidth}
      height={displayHeight}
      style={{ border: '1px solid #ddd', cursor: 'crosshair', maxWidth: '100%' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PdfTemplateBuilder/ZoneCanvas.tsx
git commit -m "feat(pdf-import): canvas rectangle painter"
```

---

## Task 14: ColumnMapper component

**Files:**
- Create: `frontend/src/components/PdfTemplateBuilder/ColumnMapper.tsx`

**Interfaces:**
- Consumes: `PdfTextItem`, `ColumnRole` from `frontend/src/api/pdf-templates.ts`.
- Produces: `<ColumnMapper pngBase64 widthPt heightPt textItems tableRect initialColumns onChange />` — given the table rectangle, displays the PNG with vertical guides at detected X-clusters, lets the user click a guide to label it.

- [ ] **Step 1: Create the component**

`frontend/src/components/PdfTemplateBuilder/ColumnMapper.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnRole, PdfTextItem } from '../../api/pdf-templates.js';

export interface Column { xStart: number; xEnd: number; role: ColumnRole }

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  textItems: PdfTextItem[];
  tableRect: { x: number; y: number; w: number; h: number };
  initialColumns: Column[] | null;
  displayMaxWidth?: number;
  onChange: (columns: Column[]) => void;
}

function inferColumns(textItems: PdfTextItem[], rect: { x: number; y: number; w: number; h: number }): Column[] {
  const itemsInRect = textItems.filter(
    (i) => i.xLeft >= rect.x && i.xLeft <= rect.x + rect.w &&
           i.yTop >= rect.y && i.yTop <= rect.y + rect.h,
  );
  const xs = [...new Set(itemsInRect.map((i) => Math.round(i.xLeft)))].sort((a, b) => a - b);
  if (xs.length === 0) return [];
  const clusters: Array<{ xStart: number; xEnd: number }> = [{ xStart: xs[0]!, xEnd: xs[0]! }];
  for (const x of xs.slice(1)) {
    const last = clusters[clusters.length - 1]!;
    if (x - last.xEnd <= 15) last.xEnd = x;
    else clusters.push({ xStart: x, xEnd: x });
  }
  return clusters.map((c) => ({ xStart: c.xStart, xEnd: c.xEnd + 50, role: 'ignore' as ColumnRole }));
}

const ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  amountSigned: 'Montant (signé)',
  debit: 'Débit',
  credit: 'Crédit',
  description: 'Libellé',
  ignore: 'Ignorer',
};

export function ColumnMapper({
  pngBase64, widthPt, heightPt, textItems, tableRect, initialColumns,
  displayMaxWidth = 720, onChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detected = useMemo(
    () => initialColumns ?? inferColumns(textItems, tableRect),
    [initialColumns, textItems, tableRect],
  );
  const [columns, setColumns] = useState<Column[]>(detected);
  const displayScale = Math.min(1, displayMaxWidth / widthPt);

  useEffect(() => { setColumns(detected); }, [detected]);
  useEffect(() => { onChange(columns); }, [columns, onChange]);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, cnv.width, cnv.height);
      ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      ctx.strokeStyle = '#0a84ff';
      ctx.fillStyle = 'rgba(10,132,255,0.06)';
      ctx.lineWidth = 1.5;
      for (const c of columns) {
        ctx.fillRect(c.xStart * displayScale, tableRect.y * displayScale,
          (c.xEnd - c.xStart) * displayScale, tableRect.h * displayScale);
        ctx.strokeRect(c.xStart * displayScale, tableRect.y * displayScale,
          (c.xEnd - c.xStart) * displayScale, tableRect.h * displayScale);
      }
    };
    img.src = `data:image/png;base64,${pngBase64}`;
  }, [pngBase64, columns, displayScale, tableRect]);

  function setRole(idx: number, role: ColumnRole) {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, role } : c)));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={widthPt * displayScale}
        height={heightPt * displayScale}
        style={{ border: '1px solid #ddd', maxWidth: '100%' }}
      />
      <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
        {columns.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'monospace', minWidth: 110 }}>
              x {Math.round(c.xStart)}–{Math.round(c.xEnd)}
            </span>
            <select value={c.role} onChange={(e) => setRole(i, e.target.value as ColumnRole)}>
              {(Object.keys(ROLE_LABELS) as ColumnRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PdfTemplateBuilder/ColumnMapper.tsx
git commit -m "feat(pdf-import): column-labeling component"
```

---

## Task 15: PdfTemplateBuilder modal

**Files:**
- Create: `frontend/src/components/PdfTemplateBuilder/index.tsx`

**Interfaces:**
- Consumes: `ZoneCanvas`, `ColumnMapper`, API client from Task 12.
- Produces: `<PdfTemplateBuilder needsTemplate accountId onClose onImported />`. Renders a three-step wizard: header zone → table zone → column mapping → submit. On success calls `onImported(importedResponse)`.

- [ ] **Step 1: Create the component**

`frontend/src/components/PdfTemplateBuilder/index.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { ColumnMapper, type Column } from './ColumnMapper.js';
import {
  submitZones,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type TemplateZones,
} from '../../api/pdf-templates.js';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  onClose: () => void;
  onImported: (r: PdfImportImported) => void;
}

type Step = 'header' | 'table' | 'columns' | 'submit';

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props) {
  const firstPage = needsTemplate.pages[0]!;
  const [step, setStep] = useState<Step>('header');
  const [headerRect, setHeaderRect] = useState<PageRect>(
    needsTemplate.suggestedZones?.headerZone ?? {
      x: 0, y: 0, w: firstPage.widthPt, h: firstPage.heightPt * 0.15,
    },
  );
  const [tableRect, setTableRect] = useState<PageRect | null>(
    needsTemplate.suggestedZones
      ? {
          x: needsTemplate.suggestedZones.tableZone.x,
          y: needsTemplate.suggestedZones.tableZone.y,
          w: needsTemplate.suggestedZones.tableZone.w,
          h: needsTemplate.suggestedZones.tableZone.h,
        }
      : null,
  );
  const [columns, setColumns] = useState<Column[]>(needsTemplate.suggestedZones?.columns ?? []);
  const [tableRepeats, setTableRepeats] = useState<boolean>(
    needsTemplate.suggestedZones?.tableRepeatsPerPage ?? true,
  );
  const [label, setLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const columnsValid = useMemo(() => {
    const d = columns.filter((c) => c.role === 'date').length;
    const desc = columns.filter((c) => c.role === 'description').length;
    const s = columns.filter((c) => c.role === 'amountSigned').length;
    const db = columns.filter((c) => c.role === 'debit').length;
    const cr = columns.filter((c) => c.role === 'credit').length;
    if (d !== 1 || desc !== 1) return false;
    return (s === 1 && db === 0 && cr === 0) || (s === 0 && db === 1 && cr === 1);
  }, [columns]);

  async function handleSubmit() {
    if (!tableRect) return;
    setSubmitting(true);
    setErr(null);
    try {
      const zones: TemplateZones = {
        headerZone: { page: 0, ...headerRect },
        tableZone: { page: 0, ...tableRect },
        tableRepeatsPerPage: tableRepeats,
        columns,
        rowsStartY: tableRect.y,
      };
      const result = await submitZones(needsTemplate.draftId, label || 'Untitled', zones);
      onImported(result);
    } catch (e: any) {
      setErr(e?.message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Définir le template PDF</h2>
          <button onClick={onClose} className="text-gray-500">✕</button>
        </div>
        {needsTemplate.reason === 'no_text_layer' && (
          <div className="bg-amber-100 border border-amber-300 text-amber-900 p-3 rounded mb-4 text-sm">
            Ce PDF semble être une image scannée. La sélection de zones fonctionne, mais l'extraction
            de lignes sera vide — l'OCR n'est pas encore disponible.
          </div>
        )}

        {step === 'header' && (
          <>
            <p className="mb-2 text-sm">
              Étape 1/3 — Sélectionnez l'en-tête (utilisé pour reconnaître cette banque la prochaine fois).
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={headerRect}
              onChange={setHeaderRect}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1 border rounded" onClick={() => setStep('table')}>Suivant →</button>
            </div>
          </>
        )}

        {step === 'table' && (
          <>
            <p className="mb-2 text-sm">
              Étape 2/3 — Sélectionnez le tableau des transactions.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={tableRect}
              onChange={setTableRect}
            />
            <label className="flex items-center gap-2 mt-3 text-sm">
              <input type="checkbox" checked={tableRepeats} onChange={(e) => setTableRepeats(e.target.checked)} />
              Le tableau se répète sur chaque page
            </label>
            <div className="flex justify-between gap-2 mt-4">
              <button className="px-3 py-1 border rounded" onClick={() => setStep('header')}>← Précédent</button>
              <button
                className="px-3 py-1 border rounded"
                disabled={!tableRect}
                onClick={() => setStep('columns')}
              >Suivant →</button>
            </div>
          </>
        )}

        {step === 'columns' && tableRect && (
          <>
            <p className="mb-2 text-sm">
              Étape 3/3 — Étiquetez chaque colonne.
            </p>
            <ColumnMapper
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              textItems={needsTemplate.textItems}
              tableRect={tableRect}
              initialColumns={columns.length > 0 ? columns : null}
              onChange={setColumns}
            />
            <div className="mt-4">
              <label className="block text-sm mb-1">Nom du template</label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex: BNP — Compte Chèques"
              />
            </div>
            {!columnsValid && (
              <p className="text-amber-700 text-sm mt-2">
                Il faut exactement 1 colonne Date, 1 colonne Libellé, et soit 1 Montant (signé), soit 1 Débit + 1 Crédit.
              </p>
            )}
            {err && <p className="text-red-700 text-sm mt-2">{err}</p>}
            <div className="flex justify-between gap-2 mt-4">
              <button className="px-3 py-1 border rounded" onClick={() => setStep('table')}>← Précédent</button>
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                disabled={!columnsValid || submitting || !label.trim()}
                onClick={handleSubmit}
              >{submitting ? 'Import…' : 'Importer'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`

Expected: no TS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PdfTemplateBuilder/index.tsx
git commit -m "feat(pdf-import): three-step zone-painting modal"
```

---

## Task 16: Imports page integration

**Files:**
- Modify: `frontend/src/pages/Imports.tsx`

**Interfaces:**
- Consumes: `submitPdf`, `PdfTemplateBuilder`, `PdfImportImported`, `PdfImportNeedsTemplate`.

- [ ] **Step 1: Read the current page**

Run: `cd frontend && head -80 src/pages/Imports.tsx`

(Or use Read on the file — you need to know the existing layout to preserve it.)

- [ ] **Step 2: Add the PDF path**

At the top:

```tsx
import { useState } from 'react';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../api/pdf-templates.js';
import { PdfTemplateBuilder } from '../components/PdfTemplateBuilder/index.js';
```

In the upload handler (the function that currently fires for OFX/CSV), branch on the file extension:

```tsx
const [needsTpl, setNeedsTpl] = useState<PdfImportNeedsTemplate | null>(null);
const [lastImported, setLastImported] = useState<PdfImportImported | null>(null);

async function handleUpload(file: File, accountId: number) {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const r = await submitPdf(file, accountId);
    if (r.kind === 'imported') setLastImported(r);
    else setNeedsTpl(r);
    return;
  }
  // ... existing OFX/CSV path unchanged ...
}
```

And render the modal/result:

```tsx
{needsTpl && (
  <PdfTemplateBuilder
    needsTemplate={needsTpl}
    onClose={() => setNeedsTpl(null)}
    onImported={(r) => { setNeedsTpl(null); setLastImported(r); }}
  />
)}
{lastImported && (
  <div className="bg-green-100 border border-green-300 p-3 rounded mt-3">
    Import terminé : {lastImported.result.insertedCount} insérées,
    {' '}{lastImported.result.dedupSkipped} déjà connues.
    {lastImported.skippedRows.length > 0 && (
      <details className="mt-2">
        <summary>{lastImported.skippedRows.length} ligne(s) ignorée(s)</summary>
        <ul className="text-xs mt-1">
          {lastImported.skippedRows.map((s, i) => (
            <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
          ))}
        </ul>
      </details>
    )}
  </div>
)}
```

- [ ] **Step 3: Manual smoke test**

Run `docker compose up --build`, navigate to `http://127.0.0.1:8000/imports`, log in, upload a real bank PDF. Expected: either auto-import success banner OR the modal opens with the first page rendered. Walk through the three steps; submit; verify rows land in `/transactions`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Imports.tsx
git commit -m "feat(pdf-import): wire .pdf path into the Imports page"
```

---

## Task 17: Fixture README and final docs

**Files:**
- Create: `backend/tests/fixtures/pdf/README.md`
- Create: `backend/tests/fixtures/pdf/.gitkeep`
- Modify: `README.md` (project root — add PDF import to the import section)

**Interfaces:**
- Consumes: nothing.
- Produces: documentation.

- [ ] **Step 1: Create the fixtures README**

`backend/tests/fixtures/pdf/README.md`:

```markdown
# PDF test fixtures

This folder is intentionally empty in the repo. If you want to add a fixture
test against a real bank PDF, **anonymize it first**:

1. Open the PDF in any editor (e.g. macOS Preview, qpdf, pdftk).
2. Redact every personally-identifying value with a black rectangle on top of
   the text layer (cover, don't delete — we want the text layer's *position*
   preserved so the heuristic still sees the column geometry):
   - account number, IBAN, BIC
   - your name, address, phone
   - any third-party names that appear as transaction labels
3. Save as a new file `<bank>-anonymized.pdf` in this folder.
4. Add a Vitest case that loads this file and asserts the heuristic + apply
   paths produce the row count and amounts you expect.

Why no committed fixtures by default: anonymization is per-user; we don't want
one person's bank layout to silently become the project's reference truth.
```

- [ ] **Step 2: Create `.gitkeep`**

Empty file at `backend/tests/fixtures/pdf/.gitkeep`.

- [ ] **Step 3: Update the project README**

In the root `README.md`, in the "Importing a statement" section, change the bullet list to include PDF:

```markdown
3. In **Imports**, upload your `.ofx` / `.qfx` / `.csv` / `.pdf` file. The
   response surfaces inserted vs deduped counts — a "0 inserted" outcome
   on a re-import means the dedup keys matched, not that anything went
   wrong. For PDFs, the first import of a new bank format opens a small
   wizard to define the table layout once; future imports of the same
   format go through automatically.
```

And in the "Roadmap" / "Possible next steps" sections, mark PDF import done if there's a relevant line; otherwise add:

```markdown
- [x] Étape 11 — PDF bank statement import (heuristic + interactive template)
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/fixtures/pdf/README.md \
        backend/tests/fixtures/pdf/.gitkeep \
        README.md
git commit -m "docs(pdf-import): fixtures README + Imports section update"
```

---

## Self-review

**1. Spec coverage**

Cross-referencing the spec sections against the plan:

- Spec "High-level pipeline" → Task 8 (orchestrator).
- Spec "Data model" → Task 1.
- Spec "Fingerprint" → Task 3.
- Spec "Heuristic extractor" → Task 4.
- Spec "Interactive template builder" → Tasks 13, 14, 15, 16.
- Spec "API surface" → Tasks 9, 11.
- Spec "Error handling" matrix → covered piecewise: encrypted (Task 9), too-large (Task 9), no text layer (Task 8), template yields 0 rows (Task 8, 9), draft expired (Task 8, 9, 10), confidence bands (Task 8).
- Spec "Testing" — three layers → Tasks 1–8 have unit/integration tests; Task 17 sets up fixture conventions. Frontend manual QA is acknowledged in Task 16.
- Spec "Libraries & footprint" → Tasks 2, 7.
- Spec "Migration" → Task 1.

No gaps.

**2. Placeholder scan**

No "TBD", "TODO", "fill in later" found. Every code block contains complete content. Test cases include actual assertions. Frontend manual QA in Task 16 is explicit ("manual smoke test"), not deferred.

**3. Type consistency**

- `TemplateZones`, `ZoneRect`, `ColumnRole` defined once in `pdf/zones.ts` (Task 1), imported everywhere else.
- `PdfTextItem`, `PdfPageText` defined in `pdf/text-extract.ts` (Task 2), imported in heuristic, template-apply, orchestrator.
- `ParsedTransaction` (existing) reused unchanged.
- `HeuristicResult` defined in `heuristic.ts` (Task 4).
- `ApplyResult` defined in `template-apply.ts` (Task 5).
- `ImportPdfResult` defined in `pdf/index.ts` (Task 8); frontend mirror in `api/pdf-templates.ts` (Task 12).
- Function name `validateZones` used consistently across Tasks 1, 8, 11.
- `runImport` signature changed in Task 8 to take `prepared?: ParsedTransaction[]`; consumers (Task 8, 9) use the new shape.

**4. Scope check**

Single feature, single user-visible flow, ~17 tasks, each independently testable. Not too large for one plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-29-pdf-bank-statement-import.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
