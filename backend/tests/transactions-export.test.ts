// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountAId: number;
let accountBId: number;
let parentCatId: number;
let childCatId: number;

function bodyLines(body: string): string[] {
  // Split on the CRLF row separator only — a quoted field may legitimately
  // contain a bare \n.
  return body.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l.length > 0);
}

describe.skipIf(!RUN)('GET /api/transactions/export', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'export-user', password: 'export-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'export-user', password: 'export-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acctA = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte courant', type: 'checking', openingDate: '2026-01-01' },
    });
    accountAId = acctA.json().account.id;
    const acctB = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Livret', type: 'savings', openingDate: '2026-01-01' },
    });
    accountBId = acctB.json().account.id;

    const parent = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Vie courante', kind: 'expense' },
    });
    parentCatId = parent.json().category.id;
    const child = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Courses', kind: 'expense', parentId: parentCatId },
    });
    childCatId = child.json().category.id;

    const fixtures = [
      {
        accountId: accountAId, date: '2026-06-15', amount: '-42.30',
        rawLabel: 'CB CARREFOUR', categoryId: childCatId,
      },
      {
        accountId: accountAId, date: '2026-06-16', amount: '-12.00',
        rawLabel: 'LABEL; WITH "QUOTES"', notes: 'ligne 1\nligne 2',
      },
      {
        accountId: accountBId, date: '2026-06-17', amount: '2500.00',
        rawLabel: 'VIR SALAIRE ACME',
      },
    ];
    for (const payload of fixtures) {
      const res = await app.inject({
        method: 'POST', url: '/api/transactions', headers: { cookie }, payload,
      });
      if (res.statusCode !== 201) throw new Error(`fixture tx failed: ${res.body}`);
    }
  });

  it('exports a UTF-8 CSV with BOM, French header, semicolon separator and comma decimals', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/transactions/export', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);
    expect(res.body.startsWith('\uFEFF')).toBe(true);

    const lines = bodyLines(res.body);
    expect(lines[0]).toBe('Date;Compte;Libellé;Catégorie;Montant;Notes');
    // 3 fixtures, newest first (list default order); the quoted-notes row
    // spans two physical lines, so count rows by leading ISO date instead.
    expect(res.body.match(/\d{4}-\d{2}-\d{2};/g)).toHaveLength(3);
    expect(lines[1]).toContain('2026-06-17');
    expect(lines[1]).toContain('2500,00');
    expect(res.body).toContain('-42,30');
  });

  it('renders the category as its Parent › Leaf path and the account by name', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/transactions/export', headers: { cookie },
    });
    expect(res.body).toContain('Vie courante › Courses');
    expect(res.body).toContain('Compte courant');
    expect(res.body).toContain('Livret');
  });

  it('escapes semicolons, quotes and newlines per RFC 4180', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/transactions/export', headers: { cookie },
    });
    expect(res.body).toContain('"LABEL; WITH ""QUOTES"""');
    expect(res.body).toContain('"ligne 1\nligne 2"');
  });

  it('honors the same filters as the list endpoint', async () => {
    const byAccount = await app.inject({
      method: 'GET', url: `/api/transactions/export?accountId=${accountAId}`,
      headers: { cookie },
    });
    expect(byAccount.body.match(/\d{4}-\d{2}-\d{2};/g)).toHaveLength(2);
    expect(byAccount.body).not.toContain('VIR SALAIRE');

    const byCategory = await app.inject({
      method: 'GET', url: `/api/transactions/export?categoryId=${childCatId}`,
      headers: { cookie },
    });
    expect(byCategory.body.match(/\d{4}-\d{2}-\d{2};/g)).toHaveLength(1);
    expect(byCategory.body).toContain('CB CARREFOUR');

    const byDate = await app.inject({
      method: 'GET',
      url: '/api/transactions/export?fromDate=2026-06-16&toDate=2026-06-16',
      headers: { cookie },
    });
    expect(byDate.body.match(/\d{4}-\d{2}-\d{2};/g)).toHaveLength(1);
    expect(byDate.body).toContain('2026-06-16');

    const bySearch = await app.inject({
      method: 'GET', url: '/api/transactions/export?search=salaire',
      headers: { cookie },
    });
    expect(bySearch.body.match(/\d{4}-\d{2}-\d{2};/g)).toHaveLength(1);
    expect(bySearch.body).toContain('VIR SALAIRE ACME');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transactions/export' });
    expect(res.statusCode).toBe(401);
  });
});
