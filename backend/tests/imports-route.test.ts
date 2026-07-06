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
  return { form, headers: form.getHeaders(), payload: form.getBuffer() };
}

describe.skipIf(!RUN)('/api/imports', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'imp-user', password: 'imp-user-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'imp-user', password: 'imp-user-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const { db } = await import('../src/db/client.js');
    const { accounts, users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [user] = await db.select().from(users).where(eq(users.username, 'imp-user'));
    const [acc] = await db.insert(accounts).values({
      userId: user!.id,
      name: 'Imports Test',
      type: 'checking',
      openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { fileImports, transactions } = await import('../src/db/schema.js');
    await db.delete(transactions);
    await db.delete(fileImports);
  });

  it('POST /api/imports rejects a request with no file part (400)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/imports',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/imports rejects an unsupported file extension (400)', async () => {
    const { headers, payload } = await buildForm('note.txt', 'nothing to import', 'text/plain');
    const res = await app.inject({
      method: 'POST', url: '/api/imports',
      headers: { cookie, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported file extension/i);
  });

  it('POST /api/imports rejects a non-integer accountId (400)', async () => {
    const { headers, payload } = await buildForm('x.csv', 'Date;Libellé;Montant\n', 'text/csv');
    const res = await app.inject({
      method: 'POST', url: '/api/imports?accountId=not-a-number',
      headers: { cookie, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/invalid accountId/i);
  });

  it('POST /api/imports errors when the account cannot be resolved (400)', async () => {
    // No accountId query param and no filename pattern configured → returns
    // a helpful 400 rather than picking an arbitrary account.
    const { headers, payload } = await buildForm(
      'no-pattern-match.csv',
      'Date;Libellé;Montant\n',
      'text/csv',
    );
    const res = await app.inject({
      method: 'POST', url: '/api/imports',
      headers: { cookie, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cannot determine target account/i);
  });

  it('GET /api/imports returns an empty list by default', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/imports',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imports).toEqual([]);
  });

  it('GET /api/imports/:id rejects a non-integer id (400)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/imports/not-a-number',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/imports/:id 404s for an unknown id', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/imports/999999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/imports/:id 404s for an unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/imports/999999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/imports/:id cascades to source transactions', async () => {
    // Seed a fileImports + linked transaction row directly.
    const { db } = await import('../src/db/client.js');
    const { fileImports, transactions } = await import('../src/db/schema.js');
    const [fi] = await db.insert(fileImports).values({
      userId: (await getUid()),
      accountId,
      filename: 'seed.ofx',
      format: 'ofx',
      importedAt: new Date(),
      totalLines: 1, insertedCount: 1, dedupSkipped: 0,
    }).returning();
    await db.insert(transactions).values({
      userId: (await getUid()),
      accountId,
      date: '2026-06-15', amount: '-10.00',
      rawLabel: 'seed', normalizedLabel: 'seed',
      dedupKey: 'seed-1', categorySource: 'auto',
      sourceFileId: fi!.id,
    });

    const res = await app.inject({
      method: 'DELETE', url: `/api/imports/${fi!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted.fileImport).toBe(1);
    expect(res.json().deleted.transactions).toBe(1);
  });

  it('PATCH /api/imports/:id rejects an empty body (400)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/imports/1',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/statedBalance.*statedBalanceDate/i);
  });

  it('PATCH /api/imports/:id rejects a non-numeric statedBalance (400)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/imports/1',
      headers: { cookie },
      payload: { statedBalance: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/statedBalance must be a number/i);
  });

  it('PATCH /api/imports/:id rejects a malformed statedBalanceDate (400)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/imports/1',
      headers: { cookie },
      payload: { statedBalanceDate: '2026/06/15' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/YYYY-MM-DD/);
  });

  it('PATCH /api/imports/:id 404s for an unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/imports/999999',
      headers: { cookie },
      payload: { statedBalance: '100.00' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/imports/:id updates statedBalance + statedBalanceDate and enriches the row', async () => {
    const { db } = await import('../src/db/client.js');
    const { fileImports } = await import('../src/db/schema.js');
    const [fi] = await db.insert(fileImports).values({
      userId: (await getUid()),
      accountId,
      filename: 'x.ofx', format: 'ofx',
      importedAt: new Date(),
      totalLines: 0, insertedCount: 0, dedupSkipped: 0,
    }).returning();
    const res = await app.inject({
      method: 'PATCH', url: `/api/imports/${fi!.id}`,
      headers: { cookie },
      payload: { statedBalance: '250.00', statedBalanceDate: '2026-06-30' },
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().fileImport;
    expect(row.statedBalance).toBe('250.00');
    expect(row.statedBalanceDate).toBe('2026-06-30');
    // The account has no transactions, so computedBalance == openingBalance
    // and delta = statedBalance − opening.
    expect(row.computedBalance).toBe('0.00');
    expect(row.delta).toBe('250.00');
  });

  it('PATCH /api/imports/:id clears the reconciliation fields when sent as null/empty', async () => {
    const { db } = await import('../src/db/client.js');
    const { fileImports } = await import('../src/db/schema.js');
    const [fi] = await db.insert(fileImports).values({
      userId: (await getUid()),
      accountId,
      filename: 'y.ofx', format: 'ofx',
      importedAt: new Date(),
      totalLines: 0, insertedCount: 0, dedupSkipped: 0,
      statedBalance: '999.00', statedBalanceDate: '2026-01-01',
    }).returning();
    const res = await app.inject({
      method: 'PATCH', url: `/api/imports/${fi!.id}`,
      headers: { cookie },
      payload: { statedBalance: null, statedBalanceDate: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fileImport.statedBalance).toBeNull();
    expect(res.json().fileImport.statedBalanceDate).toBeNull();
  });

  async function countTransactions(): Promise<number> {
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { sql } = await import('drizzle-orm');
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);
    return r?.n ?? 0;
  }

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
      expect(body.skippedRows.length).toBeGreaterThan(0);
    });
  });
});

async function getUid(): Promise<number> {
  const { db } = await import('../src/db/client.js');
  const { users } = await import('../src/db/schema.js');
  const { eq } = await import('drizzle-orm');
  const [u] = await db.select().from(users).where(eq(users.username, 'imp-user'));
  return u!.id;
}
