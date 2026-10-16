import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState } from '../seed';
import { buildSchedule } from '../../../../../backend/src/domain/loans/engine/index';
import type { Loan, LoanDetail, LoanInput, LoanListItem, LoanSimulation } from '../../loans';
import { ApiError } from '../../apiError';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

const list = async () => (await api<{ loans: LoanListItem[] }>('/api/loans')).loans;

const input = (over: Partial<LoanInput> = {}): LoanInput => ({
  name: 'Vélo', kind: 'consumer', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '1200', startDate: '2026-08-05', annualRate: '0', insuranceRate: '0',
  insuranceBasis: 'initial', fees: '0', periods: [],
  finalPeriod: { solve: 'payment', endDate: '2027-07' }, earlyRepayments: [],
  ...over,
});

describe('demo /api/loans', () => {
  it('seeds two loans and one simulation, with engine summaries', async () => {
    const loans = await list();
    expect(loans.filter((l) => !l.isSimulation)).toHaveLength(2);
    const sim = loans.find((l) => l.isSimulation)!;
    expect(sim.sourceLoanId).toBe(loans.find((l) => l.kind === 'mortgage')!.id);
    for (const l of loans) {
      const direct = buildSchedule(l, '2026-07-18');
      expect(direct.ok).toBe(true);
      expect(l.summary).toEqual(direct.ok ? direct.summary : null);
    }
  });

  it('creates, reads, updates and deletes', async () => {
    const created = await api<{ loan: Loan }>('/api/loans', { method: 'POST', json: input() });
    expect(created.loan.id).toBeGreaterThan(0);
    const detail = await api<LoanDetail>(`/api/loans/${created.loan.id}`);
    expect(detail.schedule).toHaveLength(12);
    expect(detail.summary!.solvedPayment).toBe('100.00');
    const updated = await api<{ loan: Loan }>(`/api/loans/${created.loan.id}`, {
      method: 'PUT', json: input({ finalPeriod: { solve: 'end_date', amount: '300' } }),
    });
    expect(updated.loan.finalPeriod).toEqual({ solve: 'end_date', amount: '300' });
    await api(`/api/loans/${created.loan.id}`, { method: 'DELETE' });
    expect((await list()).some((l) => l.id === created.loan.id)).toBe(false);
  });

  it('rejects a duplicate name (409) and engine errors (422 with issues)', async () => {
    await api('/api/loans', { method: 'POST', json: input() });
    await expect(api('/api/loans', { method: 'POST', json: input() })).rejects.toMatchObject({ status: 409 });
    const err = await api('/api/loans', {
      method: 'POST', json: input({ name: 'Bad', finalPeriod: { solve: 'end_date', amount: '0.01' }, annualRate: '20' }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).data).toMatchObject({ errors: [{ code: 'payment_too_low' }] });
  });

  it('simulates without saving', async () => {
    const before = (await list()).length;
    const sim = await api<LoanSimulation>('/api/loans/simulate', { method: 'POST', json: input() });
    expect(sim.summary.solvedPayment).toBe('100.00');
    expect((await list()).length).toBe(before);
  });

  it('deleting a source loan keeps its simulations, unlinked', async () => {
    const loans = await list();
    const mortgage = loans.find((l) => l.kind === 'mortgage')!;
    await api(`/api/loans/${mortgage.id}`, { method: 'DELETE' });
    const sim = (await list()).find((l) => l.isSimulation)!;
    expect(sim.sourceLoanId).toBeNull();
  });
});
