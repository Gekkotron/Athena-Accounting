import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildSchedule } from '../../../../../backend/src/domain/loans/engine/index';
import { LoanDrawer } from '../LoanDrawer';
import { pinLocale } from '../../../test/i18n';
import type { Loan, LoanDetail } from '../../../api/loans';

vi.mock('../../../api/loans', async (orig) => ({
  ...(await orig<typeof import('../../../api/loans')>()),
  getLoan: vi.fn(),
}));
import { getLoan } from '../../../api/loans';

pinLocale('loans', 'common');

const base: Loan = {
  id: 4, name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0', insuranceBasis: 'initial',
  fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
  createdAt: '', updatedAt: '',
};
const detailOf = (loan: Loan): LoanDetail => {
  const r = buildSchedule(loan, '2026-10-16');
  if (!r.ok) throw new Error('fixture');
  return { loan, schedule: r.schedule, summary: r.summary, warnings: [] };
};
const sim: Loan = {
  ...base, id: 5, name: 'Maison — 20k', isSimulation: true, sourceLoanId: 4,
  earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'shorten' }],
};

function renderDrawer(id: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><LoanDrawer id={id} onClose={() => {}} /></QueryClientProvider>);
}

describe('LoanDrawer source comparison', () => {
  beforeEach(() => vi.mocked(getLoan).mockReset());

  it('compares a simulation with its source loan', async () => {
    vi.mocked(getLoan).mockImplementation(async (id) => detailOf(id === 4 ? base : sim));
    renderDrawer(5);
    expect(await screen.findByText('Comparé à Maison')).toBeInTheDocument();
    expect(screen.getByText(/économise/)).toBeInTheDocument();
  });

  it('shows no comparison once the source is gone', async () => {
    vi.mocked(getLoan).mockImplementation(async () => detailOf({ ...sim, sourceLoanId: null }));
    renderDrawer(5);
    expect(await screen.findByRole('heading', { name: 'Maison — 20k' })).toBeInTheDocument();
    expect(screen.queryByText(/Comparé à/)).toBeNull();
    expect(getLoan).toHaveBeenCalledTimes(1);
  });
});
