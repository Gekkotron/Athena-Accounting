// requires a database — locally: DB_DRIVER=pglite RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let otherCookie: string;

async function login(username: string, password: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username, password } });
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const c = res.cookies[0]!;
  return `${c.name}=${c.value}`;
}

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Maison',
  kind: 'mortgage',
  principal: '200000.00',
  startDate: '2026-02-05',
  annualRate: '3.5',
  finalPeriod: { solve: 'payment', endDate: '2046-01' },
  ...over,
});

describe.skipIf(!RUN)('/api/loans', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await login('loans-user', 'loans-user-1234');
    otherCookie = await login('other-loans', 'other-loans-1234');
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { loans } = await import('../src/db/schema.js');
    await db.delete(loans);
  });

  const create = (payload: unknown, c = cookie) =>
    app.inject({ method: 'POST', url: '/api/loans', headers: { cookie: c }, payload });

  it('creates a loan and returns the computed summary', async () => {
    const res = await create(body());
    expect(res.statusCode).toBe(201);
    const { loan, summary } = res.json();
    expect(loan).toMatchObject({ name: 'Maison', kind: 'mortgage', annualRate: '3.5', insuranceRate: '0', isSimulation: false });
    expect(summary.solvedPayment).toBe('1159.92');
    expect(summary.endDate).toBe('2046-01-05');
  });

  it('lists loans with a summary and honours asOf', async () => {
    await create(body());
    const res = await app.inject({ method: 'GET', url: '/api/loans?asOf=2026-04-05', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const [item] = res.json().loans;
    expect(item.name).toBe('Maison');
    expect(item.summary.today).toMatchObject({ status: 'active', monthsLeft: 237 });
  });

  it('returns the full schedule on GET /:id', async () => {
    const id = (await create(body())).json().loan.id;
    const res = await app.inject({ method: 'GET', url: `/api/loans/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().schedule).toHaveLength(240);
    expect(res.json().warnings).toEqual([]);
  });

  it('replaces a loan on PUT', async () => {
    const id = (await create(body())).json().loan.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/loans/${id}`, headers: { cookie },
      payload: body({ finalPeriod: { solve: 'end_date', amount: '1400' } }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loan.finalPeriod).toEqual({ solve: 'end_date', amount: '1400' });
    expect(res.json().summary.endDate < '2046-01-05').toBe(true);
  });

  it('400 on a bad shape, 422 on an engine error', async () => {
    const bad = await create(body({ finalPeriod: undefined }));
    expect(bad.statusCode).toBe(400);
    const engine = await create(body({
      periods: [{ kind: 'partial_deferral', months: 24 }],
      finalPeriod: { solve: 'payment', endDate: '2027-01' },
    }));
    expect(engine.statusCode).toBe(422);
    expect(engine.json()).toEqual({
      error: 'invalid loan',
      errors: [{ code: 'end_before_fixed_periods', field: 'finalPeriod.endDate' }],
    });
  });

  it('409 on a duplicate name', async () => {
    await create(body());
    const res = await create(body());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'a loan with this name already exists' });
  });

  it('409 when a PUT renames a loan to a name already taken', async () => {
    await create(body({ name: 'A' }));
    const idB = (await create(body({ name: 'B' }))).json().loan.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/loans/${idB}`, headers: { cookie }, payload: body({ name: 'A' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'a loan with this name already exists' });
  });

  it('hides other users\' loans (404)', async () => {
    const id = (await create(body())).json().loan.id;
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await app.inject({ method, url: `/api/loans/${id}`, headers: { cookie: otherCookie } });
      expect(res.statusCode).toBe(404);
    }
    const put = await app.inject({ method: 'PUT', url: `/api/loans/${id}`, headers: { cookie: otherCookie }, payload: body() });
    expect(put.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/loans', headers: { cookie: otherCookie } });
    expect(list.json().loans).toEqual([]);
  });

  it('simulates without saving', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/loans/simulate', headers: { cookie },
      payload: { principal: '1200', startDate: '2026-02-05', annualRate: '0', finalPeriod: { solve: 'payment', endDate: '2027-01' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.solvedPayment).toBe('100.00');
    expect(res.json().schedule).toHaveLength(12);
    const list = await app.inject({ method: 'GET', url: '/api/loans', headers: { cookie } });
    expect(list.json().loans).toEqual([]);
  });

  it('simulation keeps living when its source loan is deleted', async () => {
    const sourceId = (await create(body())).json().loan.id;
    const sim = await create(body({ name: 'Maison — 20k', isSimulation: true, sourceLoanId: sourceId }));
    expect(sim.statusCode).toBe(201);
    const del = await app.inject({ method: 'DELETE', url: `/api/loans/${sourceId}`, headers: { cookie } });
    expect(del.json()).toEqual({ ok: true });
    const res = await app.inject({ method: 'GET', url: `/api/loans/${sim.json().loan.id}`, headers: { cookie } });
    expect(res.json().loan.sourceLoanId).toBeNull();
  });

  it('rejects a source loan owned by someone else (404) or itself (400)', async () => {
    const theirs = (await create(body(), otherCookie)).json().loan.id;
    expect((await create(body({ sourceLoanId: theirs }))).statusCode).toBe(404);
    const id = (await create(body())).json().loan.id;
    const self = await app.inject({ method: 'PUT', url: `/api/loans/${id}`, headers: { cookie }, payload: body({ sourceLoanId: id }) });
    expect(self.statusCode).toBe(400);
  });

  describe('POST /api/loans/:id/convert', () => {
    const convert = (id: number, c = cookie) =>
      app.inject({ method: 'POST', url: `/api/loans/${id}/convert`, headers: { cookie: c } });

    it('promotes a simulation to a real loan, clearing its source link', async () => {
      const sourceId = (await create(body())).json().loan.id;
      const simId = (await create(body({ name: 'Maison — sim', isSimulation: true, sourceLoanId: sourceId }))).json().loan.id;
      const res = await convert(simId);
      expect(res.statusCode).toBe(200);
      const { loan, summary } = res.json();
      expect(loan).toMatchObject({ id: simId, name: 'Maison — sim', isSimulation: false, sourceLoanId: null });
      expect(summary.solvedPayment).toBe('1159.92');
    });

    it('400 when the loan is already real', async () => {
      const id = (await create(body())).json().loan.id;
      const res = await convert(id);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'loan is not a simulation' });
    });

    it('404 on an unknown id or another user\'s simulation', async () => {
      expect((await convert(999_999)).statusCode).toBe(404);
      const simId = (await create(body({ name: 'theirs', isSimulation: true }), otherCookie)).json().loan.id;
      expect((await convert(simId)).statusCode).toBe(404);
    });
  });
});
