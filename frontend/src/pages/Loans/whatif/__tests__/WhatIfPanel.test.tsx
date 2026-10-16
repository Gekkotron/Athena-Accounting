import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildSchedule } from '../../../../../../backend/src/domain/loans/engine/index';
import { ApiError } from '../../../../api/apiError';
import { WhatIfPanel } from '../WhatIfPanel';
import { pinLocale } from '../../../../test/i18n';
import type { Loan, LoanDetail, LoanTermsInput } from '../../../../api/loans';

vi.mock('../../../../api/loans', async (orig) => ({
  ...(await orig<typeof import('../../../../api/loans')>()),
  simulateLoan: vi.fn(),
  updateLoan: vi.fn(),
}));
import { simulateLoan, updateLoan } from '../../../../api/loans';

pinLocale('loans', 'common');

const loan: Loan = {
  id: 4, name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0', insuranceBasis: 'initial',
  fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
  createdAt: '', updatedAt: '',
};
const run = (t: LoanTermsInput) => buildSchedule(t, '2026-10-16');
const r0 = run(loan);
if (!r0.ok) throw new Error('fixture');
const detail: LoanDetail = { loan, schedule: r0.schedule, summary: r0.summary, warnings: [] };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaveAsSimulation = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <WhatIfPanel detail={detail} onClose={onClose} onSaveAsSimulation={onSaveAsSimulation} />
    </QueryClientProvider>,
  );
  return { onClose, onSaveAsSimulation };
}

beforeEach(() => {
  vi.mocked(simulateLoan).mockReset().mockImplementation(async (t) => {
    const r = run(t);
    if (!r.ok) throw new ApiError('invalid loan', 422, { error: 'invalid loan', errors: r.errors });
    return { schedule: r.schedule, summary: r.summary, warnings: r.warnings };
  });
  vi.mocked(updateLoan).mockReset();
});

async function addEarlyRepayment() {
  fireEvent.change(screen.getByLabelText('À partir de (mois)'), { target: { value: '2030-01' } });
  await userEvent.type(screen.getByLabelText('Montant'), '20000');
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));
}

describe('WhatIfPanel', () => {
  it('shows the savings of an early repayment', async () => {
    renderPanel();
    await addEarlyRepayment();
    expect(await screen.findByText(/économise/)).toBeInTheDocument();
    expect(screen.getByText(/mois plus tôt/)).toBeInTheDocument();
  });

  it('rejects a new payment outside the loan', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('tab', { name: 'Nouvelle mensualité' }));
    fireEvent.change(screen.getByLabelText('À partir de (mois)'), { target: { value: '2050-01' } });
    await userEvent.type(screen.getByLabelText('Nouvelle mensualité (hors assurance)'), '1500');
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText(/Choisissez un mois pendant le prêt/)).toBeInTheDocument();
  });

  it('applies the scenario to the loan', async () => {
    vi.mocked(updateLoan).mockResolvedValue({ loan, summary: r0.summary });
    const { onClose } = renderPanel();
    await addEarlyRepayment();
    await screen.findByText(/économise/);
    await userEvent.click(screen.getByRole('button', { name: 'Appliquer au prêt' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateLoan).toHaveBeenCalledWith(4, expect.objectContaining({
      earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'shorten' }],
    }));
  });

  it('hands a simulation form to the page', async () => {
    const { onSaveAsSimulation } = renderPanel();
    await addEarlyRepayment();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer comme simulation' }));
    expect(onSaveAsSimulation).toHaveBeenCalledWith(expect.objectContaining({
      isSimulation: true, sourceLoanId: 4, name: 'Maison — simulation',
    }));
  });
});
