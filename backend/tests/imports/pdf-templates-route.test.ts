// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

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

let app: FastifyInstance;
let cookie: string;

describe.skipIf(!RUN)('/api/pdf-templates CRUD', () => {
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'tplroutes', password: 'tpl-routes-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'tplroutes', password: 'tpl-routes-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfStatementTemplates } = await import('../../src/db/schema.js');
    await db.delete(pdfStatementTemplates);
  });

  it('lists, renames, and deletes templates', async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfStatementTemplates } = await import('../../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const [tpl] = await db.insert(pdfStatementTemplates).values({
      fingerprint: 'abc123', label: 'Initial label',
      zones: minimalZones, source: 'interactive',
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

  it('returns 404 when deleting a non-existent template', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/pdf-templates/99999', headers: { cookie } });
    expect(del.statusCode).toBe(404);
  });

  it('returns 400 when PUT has nothing to update', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/pdf-templates/1',
      headers: { cookie }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
