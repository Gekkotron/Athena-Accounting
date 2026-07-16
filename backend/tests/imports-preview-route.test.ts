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

    const { db } = await import('../src/db/client.js');
    const { fileImports, transactions } = await import('../src/db/schema.js');
    expect(await db.select().from(fileImports)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});
