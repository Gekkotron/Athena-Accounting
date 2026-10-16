// requires a database — locally: DB_DRIVER=pglite RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;
const PASS = 'test-passphrase-1';

let app: FastifyInstance;
let cookie: string;

async function exportDump() {
  const { decryptEnvelope } = await import('../src/http/routes/backup/crypto.js');
  const res = await app.inject({ method: 'POST', url: '/api/backup/export', headers: { cookie }, payload: { passphrase: PASS } });
  expect(res.statusCode).toBe(200);
  return JSON.parse(decryptEnvelope(res.json(), PASS));
}

const listLoans = async () =>
  (await app.inject({ method: 'GET', url: '/api/loans', headers: { cookie } })).json().loans as Array<{
    id: number; name: string; isSimulation: boolean; sourceLoanId: number | null; periods: unknown[];
  }>;

describe.skipIf(!RUN)('backup: loans', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    const creds = { username: 'backup-loans', password: 'backup-loans-1234' };
    await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: creds });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: creds });
    const c = res.cookies[0]!;
    cookie = `${c.name}=${c.value}`;
  });

  it('round-trips loans and re-links a simulation to its source', async () => {
    const base = {
      kind: 'mortgage', principal: '200000.00', startDate: '2026-02-05', annualRate: '3.5',
      insuranceRate: '0.3', insuranceBasis: 'remaining', fees: '1500',
      periods: [{ kind: 'partial_deferral', months: 12 }],
      finalPeriod: { solve: 'payment', endDate: '2046-01' },
    };
    const src = await app.inject({ method: 'POST', url: '/api/loans', headers: { cookie }, payload: { ...base, name: 'Maison' } });
    await app.inject({
      method: 'POST', url: '/api/loans', headers: { cookie },
      payload: {
        ...base, name: 'Maison — 20k', isSimulation: true, sourceLoanId: src.json().loan.id,
        earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'shorten', penalty: '600' }],
      },
    });

    const dump = await exportDump();
    expect(dump.loans).toHaveLength(2);
    expect(dump.loans.find((l: { name: string }) => l.name === 'Maison — 20k').sourceLoan).toBe('Maison');

    const imp = await app.inject({ method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: dump });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().imported.loans).toBe(2);

    const after = await listLoans();
    const maison = after.find((l) => l.name === 'Maison')!;
    const sim = after.find((l) => l.name === 'Maison — 20k')!;
    expect(sim.isSimulation).toBe(true);
    expect(sim.sourceLoanId).toBe(maison.id);
    expect(maison.periods).toEqual([{ kind: 'partial_deferral', months: 12 }]);
  });

  it('an older dump without `loans` wipes them (REPLACE semantics)', async () => {
    const dump = await exportDump();
    delete dump.loans;
    const imp = await app.inject({ method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: dump });
    expect(imp.statusCode).toBe(200);
    expect(await listLoans()).toEqual([]);
  });

  it('preserves timestamps and nulls a source that is absent from the dump', async () => {
    const dump = await exportDump();
    const loan = {
      name: 'Orphan sim', kind: 'mortgage', isSimulation: true, sourceLoan: 'Maison',
      currency: 'EUR', principal: '100000.00', startDate: '2026-02-05', annualRate: '3.5',
      insuranceRate: '0', insuranceBasis: 'remaining', fees: '0.00', periods: [],
      finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
      createdAt: '2025-03-04T05:06:07.000Z', updatedAt: '2025-04-05T06:07:08.000Z',
    };
    const imp = await app.inject({ method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: { ...dump, loans: [loan] } });
    expect(imp.statusCode).toBe(200);
    const after = await listLoans();
    expect(after).toHaveLength(1);
    expect(after[0]!.sourceLoanId).toBeNull();
    expect((after[0] as unknown as { createdAt: string }).createdAt).toBe('2025-03-04T05:06:07.000Z');
    const again = await exportDump();
    expect(again.loans[0].updatedAt).toBe('2025-04-05T06:07:08.000Z');
  });

  it('rejects a malformed loan entry with 400', async () => {
    const dump = await exportDump();
    const bad = { ...dump.loans[0], annualRate: '150' };
    const imp = await app.inject({ method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: { ...dump, loans: [bad] } });
    expect(imp.statusCode).toBe(400);
    expect(imp.json()).toEqual(expect.objectContaining({ issues: expect.any(Array) }));
  });
});
