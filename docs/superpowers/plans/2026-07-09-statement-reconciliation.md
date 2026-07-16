# Statement Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `reconcile_statement` MCP tool that parses a bank-statement PDF via the account's saved import template and returns a deterministic matched/missing/mismatched/extra report with a backend-rendered text summary.

**Architecture:** A pure, DB-free `reconcile()` diff plus a backend `POST /api/reconcile` route that parse-only-parses the PDF (reusing the importer's template application) and diffs by `dedupKey`. Exposed through the existing encrypted `/api/mcp/rpc` tunnel via a new op and an MCP tool that reads the PDF off the Mac's filesystem. Nothing is written; adding missing rows stays the normal import.

**Tech Stack:** Node ≥20.11, TypeScript ESM, Fastify 5, Drizzle ORM, PostgreSQL, Vitest, `@modelcontextprotocol/sdk` (mcp package), Node built-in `crypto`/`fs`.

## Global Constraints

- Node ≥ 20.11; ESM (`"type":"module"`); TypeScript imports use `.js` suffixes; tsc must stay clean.
- The LLM never computes matches: all parsing/matching is deterministic backend code; the tool returns a backend-rendered `summaryText` the model only relays.
- Reuse existing primitives: `computeDedupKey` (`backend/src/domain/imports/dedup.ts`), `normalizeLabel` (`backend/src/domain/imports/normalize.ts`), `applyTemplate` + `extractText` + `fingerprintHeader` (`backend/src/domain/imports/pdf/*`). Do not reimplement PDF parsing or dedup.
- Reconcile flows through the existing tunnel + `app.inject`; no new public route. `POST /api/reconcile` sits behind `requireAuth`.
- Matching: exact `dedupKey` = matched; ±3-day tolerance for mismatch candidates; label comparison is exact equality on `normalizeLabel(...)` output (no fuzzy score).
- PDF size cap 10 MB (mirror `PDF_MAX_BYTES` in `backend/src/http/routes/imports.ts`).
- DB-touching backend tests are gated behind `process.env.RUN_DB_TESTS` via `describe.skipIf(!RUN)` and skip locally (Postgres/container runtime intentionally off); GREEN runs in CI. Pure-unit tests are ungated.
- Public-safe: no real hosts/tokens/secrets in code, tests, or docs.
- `accountId` is required on the tool; the model obtains it via `list_accounts`.

---

### Task 1: `reconcile()` diff + summary renderer (pure domain)

**Files:**
- Create: `backend/src/domain/reconcile/reconcile.ts`
- Test: `backend/tests/reconcile/reconcile.test.ts`

**Interfaces:**
- Consumes: `computeDedupKey` from `../imports/dedup.js` (tests use it to build keys).
- Produces:
  - `interface StatementLine { date: string; amount: string; rawLabel: string; normalizedLabel: string; dedupKey: string }`
  - `interface ExistingTx { id: number; date: string; amount: string; rawLabel: string; normalizedLabel: string; dedupKey: string; transferGroupId: string | null }`
  - `interface ReconcileReport { statementPeriod: { from: string; to: string }; summary: { statementLines: number; matched: number; missing: number; mismatched: number; extra: number }; missing: Array<{ date: string; amount: string; rawLabel: string }>; mismatched: Array<{ statement: { date: string; amount: string; label: string }; athena: { id: number; date: string; amount: string; label: string }; reason: 'date_off' | 'amount_differs' }>; extra: Array<{ id: number; date: string; amount: string; rawLabel: string }> }`
  - `reconcile(statement: StatementLine[], existing: ExistingTx[], opts?: { dateToleranceDays?: number; from?: string; to?: string }): ReconcileReport`
  - `renderReconcileSummary(report: ReconcileReport, accountName: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/reconcile/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcile, renderReconcileSummary, type StatementLine, type ExistingTx } from '../../src/domain/reconcile/reconcile.js';
import { computeDedupKey } from '../../src/domain/imports/dedup.js';

const ACC = 66;
function sline(date: string, amount: string, label: string): StatementLine {
  const normalizedLabel = label.toLowerCase();
  return { date, amount, rawLabel: label, normalizedLabel, dedupKey: computeDedupKey({ accountId: ACC, date, amount, normalizedLabel }) };
}
function etx(id: number, date: string, amount: string, label: string, transferGroupId: string | null = null): ExistingTx {
  const normalizedLabel = label.toLowerCase();
  return { id, date, amount, rawLabel: label, normalizedLabel, dedupKey: computeDedupKey({ accountId: ACC, date, amount, normalizedLabel }), transferGroupId };
}

describe('reconcile', () => {
  it('exact dedupKey match → matched', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(1, '2025-04-10', '-5.73', 'magasin u')];
    const r = reconcile(s, e);
    expect(r.summary).toMatchObject({ statementLines: 1, matched: 1, missing: 0, mismatched: 0, extra: 0 });
  });

  it('statement line absent from Athena → missing', () => {
    const r = reconcile([sline('2025-04-12', '-18.90', 'fnac')], []);
    expect(r.summary.missing).toBe(1);
    expect(r.missing[0]).toEqual({ date: '2025-04-12', amount: '-18.90', rawLabel: 'fnac' });
  });

  it('same amount+label, date within ±3 days → mismatched date_off (not missing)', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(9, '2025-04-12', '-5.73', 'magasin u')];
    const r = reconcile(s, e, { dateToleranceDays: 3 });
    expect(r.summary).toMatchObject({ matched: 0, mismatched: 1, missing: 0 });
    expect(r.mismatched[0]).toMatchObject({ reason: 'date_off', athena: { id: 9 } });
  });

  it('same label+date, different amount → mismatched amount_differs', () => {
    const s = [sline('2025-04-05', '-54.00', 'prime')];
    const e = [etx(7, '2025-04-05', '-45.00', 'prime')];
    const r = reconcile(s, e);
    expect(r.mismatched[0]).toMatchObject({ reason: 'amount_differs', statement: { amount: '-54.00' }, athena: { amount: '-45.00' } });
  });

  it('date beyond tolerance → missing, not mismatched', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(9, '2025-04-20', '-5.73', 'magasin u')];
    const r = reconcile(s, e, { dateToleranceDays: 3 });
    expect(r.summary).toMatchObject({ missing: 1, mismatched: 0 });
  });

  it('Athena row in period not on statement → extra; transfer legs excluded', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [
      etx(1, '2025-04-10', '-5.73', 'magasin u'),
      etx(2, '2025-04-15', '-99.00', 'erreur'),
      etx(3, '2025-04-16', '-500.00', 'virement interne', 'grp-1'),
    ];
    const r = reconcile(s, e);
    expect(r.summary.extra).toBe(1);
    expect(r.extra[0]).toMatchObject({ id: 2 });
  });

  it('each Athena row is consumed at most once', () => {
    const s = [sline('2025-04-10', '-5.73', 'magasin u'), sline('2025-04-10', '-5.73', 'magasin u')];
    const e = [etx(1, '2025-04-10', '-5.73', 'magasin u')];
    const r = reconcile(s, e);
    expect(r.summary).toMatchObject({ matched: 1, missing: 1 });
  });

  it('period derives from statement min/max date', () => {
    const r = reconcile([sline('2025-04-03', '-1.00', 'a'), sline('2025-04-28', '-2.00', 'b')], []);
    expect(r.statementPeriod).toEqual({ from: '2025-04-03', to: '2025-04-28' });
  });

  it('renderReconcileSummary produces a one-glance line + missing detail', () => {
    const s = [sline('2025-04-12', '-18.90', 'fnac')];
    const r = reconcile(s, []);
    const text = renderReconcileSummary(r, 'Courant');
    expect(text).toContain('Courant');
    expect(text).toContain('1 missing');
    expect(text).toContain('2025-04-12');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/reconcile/reconcile.test.ts`
Expected: FAIL — cannot find module `../../src/domain/reconcile/reconcile.js`.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/domain/reconcile/reconcile.ts

export interface StatementLine {
  date: string; amount: string; rawLabel: string; normalizedLabel: string; dedupKey: string;
}
export interface ExistingTx {
  id: number; date: string; amount: string; rawLabel: string;
  normalizedLabel: string; dedupKey: string; transferGroupId: string | null;
}
export interface ReconcileReport {
  statementPeriod: { from: string; to: string };
  summary: { statementLines: number; matched: number; missing: number; mismatched: number; extra: number };
  missing: Array<{ date: string; amount: string; rawLabel: string }>;
  mismatched: Array<{
    statement: { date: string; amount: string; label: string };
    athena: { id: number; date: string; amount: string; label: string };
    reason: 'date_off' | 'amount_differs';
  }>;
  extra: Array<{ id: number; date: string; amount: string; rawLabel: string }>;
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function reconcile(
  statement: StatementLine[],
  existing: ExistingTx[],
  opts: { dateToleranceDays?: number; from?: string; to?: string } = {},
): ReconcileReport {
  const tol = opts.dateToleranceDays ?? 3;
  const used = new Set<number>();
  const byDedup = new Map<string, number[]>();
  existing.forEach((e, i) => {
    const arr = byDedup.get(e.dedupKey) ?? [];
    arr.push(i);
    byDedup.set(e.dedupKey, arr);
  });

  let matched = 0;
  const missing: ReconcileReport['missing'] = [];
  const mismatched: ReconcileReport['mismatched'] = [];

  for (const s of statement) {
    const exact = (byDedup.get(s.dedupKey) ?? []).find((i) => !used.has(i));
    if (exact !== undefined) { used.add(exact); matched++; continue; }

    let candIdx = -1;
    let reason: 'date_off' | 'amount_differs' | null = null;
    for (let i = 0; i < existing.length; i++) {
      if (used.has(i)) continue;
      const e = existing[i]!;
      if (Math.abs(dayDiff(s.date, e.date)) > tol) continue;
      if (e.normalizedLabel !== s.normalizedLabel) continue;
      if (e.amount === s.amount) { candIdx = i; reason = 'date_off'; break; }        // same amount+label, off by days
      candIdx = i; reason = 'amount_differs'; break;                                  // same label+date-ish, amount differs
    }
    if (candIdx >= 0 && reason) {
      used.add(candIdx);
      const e = existing[candIdx]!;
      mismatched.push({
        statement: { date: s.date, amount: s.amount, label: s.rawLabel },
        athena: { id: e.id, date: e.date, amount: e.amount, label: e.rawLabel },
        reason,
      });
      continue;
    }
    missing.push({ date: s.date, amount: s.amount, rawLabel: s.rawLabel });
  }

  const dates = statement.map((s) => s.date).sort();
  const from = opts.from ?? dates[0] ?? '';
  const to = opts.to ?? dates[dates.length - 1] ?? '';

  const extra = existing
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !used.has(i) && e.transferGroupId === null && e.date >= from && e.date <= to)
    .map(({ e }) => ({ id: e.id, date: e.date, amount: e.amount, rawLabel: e.rawLabel }));

  return {
    statementPeriod: { from, to },
    summary: { statementLines: statement.length, matched, missing: missing.length, mismatched: mismatched.length, extra: extra.length },
    missing, mismatched, extra,
  };
}

export function renderReconcileSummary(report: ReconcileReport, accountName: string): string {
  const { summary: s, statementPeriod: p } = report;
  const lines: string[] = [];
  lines.push(
    `${p.from}–${p.to} · account "${accountName}" — ${s.statementLines} statement lines: ` +
    `${s.matched} matched, ${s.missing} missing, ${s.mismatched} mismatch, ${s.extra} extra.`,
  );
  if (report.missing.length) {
    lines.push('Missing (not in Athena): ' + report.missing.map((m) => `${m.date} ${m.amount} ${m.rawLabel}`).join('; ') + '.');
  }
  if (report.mismatched.length) {
    lines.push('Mismatch: ' + report.mismatched.map((m) => `${m.statement.date} ${m.statement.label} — statement ${m.statement.amount} vs Athena ${m.athena.amount} (${m.reason})`).join('; ') + '.');
  }
  if (report.extra.length) {
    lines.push('Extra (in Athena, not on statement): ' + report.extra.map((e) => `${e.date} ${e.amount} ${e.rawLabel}`).join('; ') + '.');
  }
  if (s.missing > 0) {
    lines.push('To add the missing transactions, import this PDF in Athena — dedup will insert only these and skip the rest.');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/reconcile/reconcile.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/reconcile/reconcile.ts backend/tests/reconcile/reconcile.test.ts
git commit -m "feat(reconcile): deterministic statement/Athena diff + summary renderer"
```

---

### Task 2: `parseStatementRows()` shared parse-only helper + `importPdf` reuse

**Files:**
- Modify: `backend/src/domain/imports/pdf/index.ts`
- Create: `backend/src/domain/imports/pdf/parse-rows.ts`
- Test: `backend/tests/imports/parse-rows.test.ts`

**Interfaces:**
- Consumes: `applyTemplate` from `./template-apply.js`; `PdfPageText` from `./text-extract.js`; `TemplateZones` from `./zones.js`; `ParsedTransaction` from `../ofx-parser.js`.
- Produces:
  - `type ParseRowsResult = { kind: 'parsed'; rows: ParsedTransaction[]; skippedRows: Array<{ rowText: string; reason: string }> } | { kind: 'stale'; skippedRows: Array<{ rowText: string; reason: string }> }`
  - `parseStatementRows(pages: PdfPageText[], zones: TemplateZones): ParseRowsResult`

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/imports/parse-rows.test.ts
import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import { parseStatementRows } from '../../src/domain/imports/pdf/parse-rows.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}
const goodPages = [page([
  item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
  item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
  item('16/01/2026', 40, 235), item('VIR LOYER', 120, 235), item('-850,00', 480, 235),
])];

describe('parseStatementRows', () => {
  it('returns parsed rows equal to applyTemplate output for a working template', () => {
    const h = runHeuristic(goodPages);
    const res = parseStatementRows(goodPages, h.zones!);
    expect(res.kind).toBe('parsed');
    if (res.kind === 'parsed') {
      expect(res.rows).toEqual(applyTemplate(goodPages, h.zones!).rows);
      expect(res.rows.length).toBe(2);
    }
  });

  it('returns stale when the template yields zero rows', () => {
    const h = runHeuristic(goodPages);
    const empty = [page([item('nothing', 10, 10)])];
    const res = parseStatementRows(empty, h.zones!);
    expect(res.kind).toBe('stale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/imports/parse-rows.test.ts`
Expected: FAIL — cannot find module `parse-rows.js`.

- [ ] **Step 3: Write `parse-rows.ts`**

```ts
// backend/src/domain/imports/pdf/parse-rows.ts
import { applyTemplate } from './template-apply.js';
import type { PdfPageText } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';

export type ParseRowsResult =
  | { kind: 'parsed'; rows: ParsedTransaction[]; skippedRows: Array<{ rowText: string; reason: string }> }
  | { kind: 'stale'; skippedRows: Array<{ rowText: string; reason: string }> };

// Apply a saved template to already-extracted pages, WITHOUT inserting.
// Zero rows means the template no longer matches this PDF (caller decides
// whether to re-train the wizard or report needs_template).
export function parseStatementRows(pages: PdfPageText[], zones: TemplateZones): ParseRowsResult {
  const { rows, skippedRows } = applyTemplate(pages, zones);
  if (rows.length === 0) return { kind: 'stale', skippedRows };
  return { kind: 'parsed', rows, skippedRows };
}
```

- [ ] **Step 4: Refactor `importPdf` step-1 to use it (behavior-preserving)**

In `backend/src/domain/imports/pdf/index.ts`, add the import near the others:

```ts
import { parseStatementRows } from './parse-rows.js';
```

Replace the template-application block inside `importPdf` (the `if (tpl) { ... }` body that currently calls `applyTemplate` and checks `rows.length === 0`) with:

```ts
    if (tpl) {
      const z = tpl.zones as TemplateZones;
      const parsed = parseStatementRows(pages, z);
      if (parsed.kind === 'stale') {
        const diag = diagnoseStaleTemplate(pages, z, parsed.skippedRows);
        return await parkDraft(opts, pages, fingerprint, z, 'template_stale', diag);
      }
      const result = await runImport({
        filename: opts.filename,
        accountId: opts.accountId,
        userId: opts.userId,
        format: 'pdf',
        prepared: parsed.rows,
      });
      return { kind: 'imported', result, skippedRows: parsed.skippedRows };
    }
```

This preserves the exact prior behavior (stale → park draft with diagnostic; else import) while sharing the rows/stale decision with reconcile.

- [ ] **Step 5: Run tests to verify pass + no regression**

Run: `cd backend && npx vitest run tests/imports/parse-rows.test.ts && npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: parse-rows 2/2 PASS; tsc clean; full suite PASS with only the usual DB-gated skips (no new failures — the existing PDF import suites still pass locally where they don't need DB).

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/imports/pdf/parse-rows.ts backend/src/domain/imports/pdf/index.ts backend/tests/imports/parse-rows.test.ts
git commit -m "refactor(imports): extract parseStatementRows; reuse in importPdf"
```

---

### Task 3: `POST /api/reconcile` route + tunnel op

**Files:**
- Create: `backend/src/http/routes/reconcile.ts`
- Modify: `backend/src/server.ts` (register in the authenticated block)
- Modify: `backend/src/http/routes/mcp/ops.ts` (add the `reconcile_statement` op)
- Test: `backend/tests/reconcile/reconcile-route.test.ts`

**Interfaces:**
- Consumes: `reconcile`, `renderReconcileSummary`, `StatementLine`, `ExistingTx` (Task 1); `parseStatementRows` (Task 2); `extractText` (`../../domain/imports/pdf/text-extract.js`), `fingerprintHeader` (`../../domain/imports/pdf/fingerprint.js`), `normalizeLabel` (`../../domain/imports/normalize.js`), `computeDedupKey` (`../../domain/imports/dedup.js`); `db`, `accounts`, `transactions`, `pdfStatementTemplates`; `userId`.
- Produces: `async function reconcileRoutes(app)`; route `POST /api/reconcile`; op `reconcile_statement` → `POST /api/reconcile`.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/tests/reconcile/reconcile-route.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import PDFDocument from 'pdfkit';
const RUN = !!process.env.RUN_DB_TESTS;

// Build a minimal text-table PDF and return its base64.
function makeStatementPdf(rows: Array<[string, string, string]>): Promise<string> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.fontSize(10).text('Date', 40, 200); doc.text('Libellé', 160, 200); doc.text('Montant', 460, 200);
    let y = 220;
    for (const [date, label, amount] of rows) {
      doc.text(date, 40, y); doc.text(label, 160, y); doc.text(amount, 460, y);
      y += 18;
    }
    doc.end();
  });
}

describe.skipIf(!RUN)('POST /api/reconcile', () => {
  let app: FastifyInstance;
  let cookie: string;
  let accountId: number;

  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'recon', password: 'recon-1234' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'recon', password: 'recon-1234' } });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const acc = await app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie }, payload: { name: 'Courant', type: 'courant', openingDate: '2025-01-01' } });
    accountId = acc.json().account.id;
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { transactions, pdfStatementTemplates } = await import('../../src/db/schema.js');
    await db.delete(transactions);
    await db.delete(pdfStatementTemplates);
  });

  it('no matching template → 422 needs_template', async () => {
    const pdfBase64 = await makeStatementPdf([['15/01/2025', 'CB CARREFOUR', '-42,30']]);
    const res = await app.inject({ method: 'POST', url: '/api/reconcile', headers: { cookie }, payload: { pdfBase64, accountId } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('needs_template');
  });

  it('with a saved template → four-bucket report; seeded row matches, unseeded is missing', async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfStatementTemplates } = await import('../../src/db/schema.js');
    const { extractText } = await import('../../src/domain/imports/pdf/text-extract.js');
    const { fingerprintHeader } = await import('../../src/domain/imports/pdf/fingerprint.js');
    const { runHeuristic } = await import('../../src/domain/imports/pdf/heuristic.js');
    const { parseStatementRows } = await import('../../src/domain/imports/pdf/parse-rows.js');

    const pdfBase64 = await makeStatementPdf([
      ['15/01/2025', 'CB CARREFOUR', '-42,30'],
      ['16/01/2025', 'VIR LOYER', '-850,00'],
    ]);
    const buffer = Buffer.from(pdfBase64, 'base64');
    const pages = await extractText(buffer);
    const h = runHeuristic(pages);
    // Derive the template from the same extraction so alignment is guaranteed.
    await db.insert(pdfStatementTemplates).values({
      userId: 1, fingerprint: fingerprintHeader(pages[0]!), accountId, label: 'test', zones: h.zones!, source: 'heuristic',
    });
    const parsed = parseStatementRows(pages, h.zones!);
    expect(parsed.kind).toBe('parsed');
    const rows = parsed.kind === 'parsed' ? parsed.rows : [];
    expect(rows.length).toBe(2);

    // Seed ONLY the first parsed row into Athena via the manual create endpoint,
    // so exactly one line should be "matched" and one "missing".
    await app.inject({ method: 'POST', url: '/api/transactions', headers: { cookie }, payload: { accountId, date: rows[0]!.date, amount: rows[0]!.amount, rawLabel: rows[0]!.rawLabel } });

    const res = await app.inject({ method: 'POST', url: '/api/reconcile', headers: { cookie }, payload: { pdfBase64, accountId } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.statementLines).toBe(2);
    expect(body.summary.matched).toBe(1);
    expect(body.summary.missing).toBe(1);
    expect(typeof body.summaryText).toBe('string');
    expect(body.summaryText).toContain('missing');
  });

  it('rejects an account the user does not own', async () => {
    const pdfBase64 = await makeStatementPdf([['15/01/2025', 'X', '-1,00']]);
    const res = await app.inject({ method: 'POST', url: '/api/reconcile', headers: { cookie }, payload: { pdfBase64, accountId: 999999 } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/reconcile/reconcile-route.test.ts`
Expected: FAIL — `/api/reconcile` 404. (If Postgres is unavailable locally, the suite SKIPS instead — that is acceptable; the route still must be written and tsc-clean, and CI runs it.)

- [ ] **Step 3: Write the route**

```ts
// backend/src/http/routes/reconcile.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, between, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, transactions, pdfStatementTemplates } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { extractText } from '../../domain/imports/pdf/text-extract.js';
import { fingerprintHeader } from '../../domain/imports/pdf/fingerprint.js';
import { parseStatementRows } from '../../domain/imports/pdf/parse-rows.js';
import type { TemplateZones } from '../../domain/imports/pdf/zones.js';
import { normalizeLabel } from '../../domain/imports/normalize.js';
import { computeDedupKey } from '../../domain/imports/dedup.js';
import { reconcile, renderReconcileSummary, type StatementLine, type ExistingTx } from '../../domain/reconcile/reconcile.js';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

const Body = z.object({
  pdfBase64: z.string().min(1),
  accountId: z.number().int().positive(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function reconcileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/reconcile', async (req, reply) => {
    const uid = userId(req);
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    const { pdfBase64, accountId, fromDate, toDate } = parsed.data;

    const [acc] = await db.select({ id: accounts.id, name: accounts.name })
      .from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
    if (!acc) return reply.code(400).send({ error: 'account not found' });

    const buffer = Buffer.from(pdfBase64, 'base64');
    if (buffer.byteLength > PDF_MAX_BYTES) return reply.code(413).send({ error: 'PDF exceeds 10MB limit' });

    let pages;
    try {
      pages = await extractText(buffer);
    } catch (err: any) {
      if (err?.code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
      return reply.code(400).send({ error: 'could not read PDF', message: err instanceof Error ? err.message : String(err) });
    }
    if (pages.every((p) => p.items.length === 0)) {
      return reply.code(422).send({ code: 'needs_template', reason: 'no_text_layer', error: 'PDF has no text layer; set up a template via Athena import first' });
    }
    const fingerprint = fingerprintHeader(pages[0]!);
    const [tpl] = await db.select().from(pdfStatementTemplates)
      .where(and(eq(pdfStatementTemplates.fingerprint, fingerprint), eq(pdfStatementTemplates.accountId, accountId)));
    if (!tpl) {
      return reply.code(422).send({ code: 'needs_template', reason: 'no_template', error: 'no saved template for this statement + account; import it once in Athena first' });
    }
    const rowsRes = parseStatementRows(pages, tpl.zones as TemplateZones);
    if (rowsRes.kind === 'stale') {
      return reply.code(422).send({ code: 'needs_template', reason: 'template_stale', error: 'saved template no longer matches this PDF; re-train it via Athena import' });
    }

    const statement: StatementLine[] = rowsRes.rows.map((r) => {
      const normalizedLabel = normalizeLabel(r.rawLabel);
      return {
        date: r.date, amount: r.amount, rawLabel: r.rawLabel, normalizedLabel,
        dedupKey: computeDedupKey({ accountId, date: r.date, amount: r.amount, normalizedLabel, fitid: r.fitid }),
      };
    });

    const dates = statement.map((s) => s.date).sort();
    const from = fromDate ?? dates[0] ?? '0000-01-01';
    const to = toDate ?? dates[dates.length - 1] ?? '9999-12-31';

    const rows = await db.select({
      id: transactions.id, date: transactions.date, amount: transactions.amount,
      rawLabel: transactions.rawLabel, normalizedLabel: transactions.normalizedLabel,
      dedupKey: transactions.dedupKey, transferGroupId: transactions.transferGroupId,
    }).from(transactions)
      .where(and(eq(transactions.userId, uid), eq(transactions.accountId, accountId), between(transactions.date, from, to)));
    const existing: ExistingTx[] = rows.map((r) => ({ ...r }));

    const report = reconcile(statement, existing, { dateToleranceDays: 3, from, to });
    return { account: { id: acc.id, name: acc.name }, ...report, summaryText: renderReconcileSummary(report, acc.name) };
  });
}
```

- [ ] **Step 4: Register the route and add the tunnel op**

In `backend/src/server.ts`, import and register among the authenticated routes (after `budgetsRoutes` or alongside the others):

```ts
import { reconcileRoutes } from './http/routes/reconcile.js';
// ... within build(): await app.register(reconcileRoutes);
```

In `backend/src/http/routes/mcp/ops.ts`, add a case to `buildOp`'s switch (before `default`):

```ts
    case 'reconcile_statement':
      return { method: 'POST', url: '/api/reconcile', payload: args };
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd backend && npx tsc -p tsconfig.json --noEmit && RUN_DB_TESTS=1 npx vitest run tests/reconcile/reconcile-route.test.ts`
Expected: tsc clean; tests PASS in CI (3 tests). Locally without Postgres the suite SKIPS — acceptable.

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/routes/reconcile.ts backend/src/server.ts backend/src/http/routes/mcp/ops.ts backend/tests/reconcile/reconcile-route.test.ts
git commit -m "feat(reconcile): POST /api/reconcile route + reconcile_statement tunnel op"
```

---

### Task 4: MCP `reconcile_statement` tool + `search_transactions` summary

**Files:**
- Modify: `mcp/src/tools.ts`
- Test: `mcp/tests/reconcile-tool.test.ts`

**Interfaces:**
- Consumes: `RpcClient` (via the `RpcLike` interface already in `tools.ts`); `node:fs`.
- Produces: a `reconcile_statement` tool registered on the MCP server; a summary line prepended to `search_transactions` output. Exports `readPdfBase64(path: string): string` (for testing the file validation) and `summarizeSearch(result: unknown): string`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp/tests/reconcile-tool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readPdfBase64, summarizeSearch } from '../src/tools.js';

vi.mock('node:fs', () => {
  const files: Record<string, Buffer> = { '/tmp/ok.pdf': Buffer.from('%PDF-1.4 fake') };
  return {
    statSync: (p: string) => { if (!files[p]) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { size: files[p].length, isFile: () => true }; },
    readFileSync: (p: string) => files[p],
  };
});

describe('reconcile tool helpers', () => {
  it('readPdfBase64 reads + base64-encodes an existing .pdf', () => {
    expect(readPdfBase64('/tmp/ok.pdf')).toBe(Buffer.from('%PDF-1.4 fake').toString('base64'));
  });
  it('rejects a non-.pdf path', () => {
    expect(() => readPdfBase64('/tmp/ok.txt')).toThrow(/\.pdf/);
  });
  it('rejects a missing file', () => {
    expect(() => readPdfBase64('/tmp/missing.pdf')).toThrow(/not found|ENOENT/i);
  });
  it('summarizeSearch produces a one-line count/range/total', () => {
    const result = { transactions: [
      { date: '2025-04-01', amount: '-10.00' }, { date: '2025-04-30', amount: '-2.40' },
    ], pagination: { total: 2 } };
    const line = summarizeSearch(result);
    expect(line).toContain('2 transaction');
    expect(line).toContain('2025-04-01');
    expect(line).toContain('2025-04-30');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run tests/reconcile-tool.test.ts`
Expected: FAIL — `readPdfBase64`/`summarizeSearch` not exported.

- [ ] **Step 3: Implement in `mcp/src/tools.ts`**

Add near the top:

```ts
import { statSync, readFileSync } from 'node:fs';

const PDF_MAX_BYTES = 10 * 1024 * 1024;

export function readPdfBase64(path: string): string {
  if (!path.toLowerCase().endsWith('.pdf')) throw new Error(`not a .pdf file: ${path}`);
  let stat;
  try { stat = statSync(path); } catch { throw new Error(`file not found: ${path}`); }
  if (stat.size > PDF_MAX_BYTES) throw new Error(`PDF exceeds 10MB: ${path}`);
  return readFileSync(path).toString('base64');
}

export function summarizeSearch(result: unknown): string {
  const r = result as { transactions?: Array<{ date: string; amount: string }>; pagination?: { total?: number } };
  const txs = r.transactions ?? [];
  if (txs.length === 0) return '0 transactions found.';
  const dates = txs.map((t) => t.date).sort();
  const total = txs.reduce((sum, t) => sum + Number(t.amount), 0);
  const shown = r.pagination?.total ?? txs.length;
  return `${shown} transaction(s), ${dates[0]}–${dates[dates.length - 1]}, shown total ${total.toFixed(2)} €.`;
}
```

In `registerTools`, after the existing `TOOL_SPECS` loop, adjust `search_transactions` rendering and register the reconcile tool. Replace the body of the `for (const spec of TOOL_SPECS)` handler's success branch so `search_transactions` gets a summary line:

```ts
      try {
        const result = await callTool(client, spec.op, args);
        const text = spec.op === 'search_transactions'
          ? `${summarizeSearch(result)}\n\n${JSON.stringify(result, null, 2)}`
          : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
```

Then, after the loop, register the reconcile tool (it is not a plain passthrough — it reads a file first):

```ts
  server.tool(
    'reconcile_statement',
    "Reconcile a bank-statement PDF against Athena. Reads a PDF file on this machine, compares it to recorded transactions, and returns matched/missing/mismatched/extra. Read-only — it never changes data.",
    {
      path: z.string().describe('Absolute path to the statement PDF on this machine'),
      accountId: z.number().int().positive().describe('Athena account id (from list_accounts)'),
      fromDate: dateStr.optional(),
      toDate: dateStr.optional(),
    },
    async (args: Record<string, unknown>) => {
      try {
        const pdfBase64 = readPdfBase64(String(args.path));
        const result = await client.rpc('reconcile_statement', {
          pdfBase64, accountId: args.accountId, fromDate: args.fromDate, toDate: args.toDate,
        }) as { summaryText?: string };
        const text = (result.summaryText ? `${result.summaryText}\n\n` : '') + JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
```

(`dateStr` is the existing `z.string().regex(/^\d{4}-\d{2}-\d{2}$/, …)` const already defined in `tools.ts`.)

- [ ] **Step 4: Run tests + build**

Run: `cd mcp && npx vitest run tests/reconcile-tool.test.ts && npm run build`
Expected: tests PASS (4); full package `npx vitest run` still green; `npm run build` (tsc) clean.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools.ts mcp/tests/reconcile-tool.test.ts
git commit -m "feat(mcp): reconcile_statement tool + search_transactions summary line"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/users/mcp.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Reconcile a statement" section**

Append a section to `docs/users/mcp.md` covering (placeholders only — no real hosts/tokens):
1. **What it does** — read-only; parses a statement PDF via the account's saved Athena import template and reports matched/missing/mismatched/extra; the LLM only relays the backend `summaryText`. It never writes.
2. **Prerequisite** — the account must already have a working PDF import template (import the statement once in Athena first). If not, the tool returns `needs_template`.
3. **Usage in LM Studio** — load a tools-capable model; in chat: *"Use reconcile_statement with path /Users/you/statements/april.pdf and accountId 66."* The model calls the tool; you read the summary.
4. **Adding the missing transactions** — the tool is read-only; to add the N missing rows, import the same PDF through Athena's normal import (dedup inserts only the missing ones).
5. **Tool reference** — `reconcile_statement(path, accountId, fromDate?, toDate?)`; note `accountId` comes from `list_accounts`.

- [ ] **Step 2: Verify**

Run: `grep -n "reconcile_statement" docs/users/mcp.md`
Expected: the new section references the tool.

- [ ] **Step 3: Commit**

```bash
git add docs/users/mcp.md
git commit -m "docs(reconcile): document the reconcile_statement tool"
```

---

## Final verification

- [ ] Backend unit (no DB): `cd backend && npx vitest run tests/reconcile/reconcile.test.ts tests/imports/parse-rows.test.ts`
- [ ] Backend full + typecheck: `cd backend && npx tsc -p tsconfig.json --noEmit && npx vitest run` (DB-gated reconcile-route suite skips locally)
- [ ] Backend DB-gated in CI: `RUN_DB_TESTS=1 npx vitest run tests/reconcile/` — route buckets + needs_template.
- [ ] MCP package: `cd mcp && npx vitest run && npm run build`
- [ ] Manual smoke (documented): with the backend running and a template set up, `reconcile_statement` on a real statement PDF returns a correct four-bucket summary; the numbers match a hand check on a small statement.
