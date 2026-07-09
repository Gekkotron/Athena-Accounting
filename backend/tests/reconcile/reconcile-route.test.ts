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
  // The shared test DB runs in multi-user mode: user ids are serial and are
  // NOT reset between test files, so `recon` is only id 1 when this file runs
  // first. Capture its real id and seed rows under it — hardcoding userId: 1
  // makes the seeded transaction invisible to the route's userId-scoped fetch
  // and silently drops `matched` to 0 in a full-suite run.
  let ownerId: number;

  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    const onboard = await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'recon', password: 'recon-1234' } });
    ownerId = onboard.json().user.id;
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
      userId: ownerId, fingerprint: fingerprintHeader(pages[0]!), accountId, label: 'test', zones: h.zones!, source: 'heuristic',
    });
    const parsed = parseStatementRows(pages, h.zones!);
    expect(parsed.kind).toBe('parsed');
    const rows = parsed.kind === 'parsed' ? parsed.rows : [];
    expect(rows.length).toBe(2);

    // Seed ONLY the first parsed row so exactly one line is "matched" and one
    // "missing". Insert directly (not via POST /api/transactions): the heuristic
    // can leave rawLabel empty on a synthetic pdfkit PDF, which the create
    // endpoint rejects (rawLabel min length 1). We insert with the SAME
    // computeDedupKey the route derives, so the dedup keys match regardless of
    // what rawLabel/normalizedLabel come out as.
    const { normalizeLabel } = await import('../../src/domain/imports/normalize.js');
    const { computeDedupKey } = await import('../../src/domain/imports/dedup.js');
    const { transactions } = await import('../../src/db/schema.js');
    const seed = rows[0]!;
    const seedNorm = normalizeLabel(seed.rawLabel);
    await db.insert(transactions).values({
      userId: ownerId, accountId, date: seed.date, amount: seed.amount,
      rawLabel: seed.rawLabel || 'seed', normalizedLabel: seedNorm,
      dedupKey: computeDedupKey({ accountId, date: seed.date, amount: seed.amount, normalizedLabel: seedNorm, fitid: seed.fitid }),
    });

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
