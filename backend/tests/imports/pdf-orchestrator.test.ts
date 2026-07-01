// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// All DB-touching imports are deferred so that module collection doesn't
// trigger env.ts / process.exit(1) when DATABASE_URL is absent.
const RUN = !!process.env.RUN_DB_TESTS;

async function buildStatementPdf(): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
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

describe.skipIf(!RUN)('importPdf', () => {
  beforeAll(async () => {
    const { db } = await import('../../src/db/client.js');
    const { accounts, users } = await import('../../src/db/schema.js');
    const [user] = await db.insert(users).values({
      username: 'pdf-orchestrator-test',
      passwordHash: 'not-a-real-hash',
    }).returning();
    const [acc] = await db.insert(accounts).values({
      userId: user!.id,
      name: 'PDF Test Account', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfImportDrafts, pdfStatementTemplates } = await import('../../src/db/schema.js');
    await db.delete(pdfImportDrafts);
    await db.delete(pdfStatementTemplates);
  });

  it('auto-imports on high heuristic confidence and silently saves the template', async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfStatementTemplates } = await import('../../src/db/schema.js');
    const { importPdf } = await import('../../src/domain/imports/pdf/index.js');
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
    const { importPdf } = await import('../../src/domain/imports/pdf/index.js');
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
