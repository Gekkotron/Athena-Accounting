// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

async function buildStatementPdf(): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica').fontSize(10);
    doc.text('BANQUE EXAMPLE', 40, 30);
    doc.text('Date',    40,  200);
    doc.text('Libellé', 120, 200);
    doc.text('Montant', 480, 200);
    doc.text('15/01/2026',   40,  220);
    doc.text('CB CARREFOUR', 120, 220);
    doc.text('-42,30',       480, 220);
    doc.text('17/01/2026',   40,  240);
    doc.text('SALAIRE',      120, 240);
    doc.text('1 200,00',     480, 240);
    doc.end();
  });
}

let app: FastifyInstance;
let cookie: string;
let accountId: number;

describe.skipIf(!RUN)('POST /api/imports with .pdf', () => {
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    const FormData = (await import('form-data')).default;
    app = await buildApp();

    // Create user + login to obtain session cookie.
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'pdfroutes', password: 'pdf-routes-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'pdfroutes', password: 'pdf-routes-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const { db } = await import('../../src/db/client.js');
    const { accounts, users } = await import('../../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [user] = await db.select().from(users).where(eq(users.username, 'pdfroutes'));
    const [acc] = await db.insert(accounts).values({
      userId: user!.id,
      name: 'PDF Routes Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;

    // suppress unused import warning — FormData is used in tests below
    void FormData;
  });

  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfImportDrafts, pdfStatementTemplates } = await import('../../src/db/schema.js');
    await db.delete(pdfImportDrafts);
    await db.delete(pdfStatementTemplates);
  });

  it('auto-imports when heuristic confidence is high', async () => {
    const FormData = (await import('form-data')).default;
    const buf = await buildStatementPdf();
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

  it('returns needs_template when confidence is low', async () => {
    const FormData = (await import('form-data')).default;
    // A blank PDF has no text → low confidence → needs_template
    const PDFDocument = (await import('pdfkit')).default;
    const blankBuf = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.end();
    });
    const form = new FormData();
    form.append('file', blankBuf, { filename: 'blank.pdf', contentType: 'application/pdf' });
    const res = await app.inject({
      method: 'POST', url: `/api/imports?accountId=${accountId}`,
      headers: { cookie, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('needs_template');
    expect(typeof body.draftId).toBe('number');
  });
});
