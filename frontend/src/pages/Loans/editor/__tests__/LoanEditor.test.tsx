import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildSchedule } from '../../../../../../backend/src/domain/loans/engine/index';
import { ApiError } from '../../../../api/apiError';
import { LoanEditor } from '../LoanEditor';
import { emptyForm, type LoanForm } from '../form-state';
import { pinLocale } from '../../../../test/i18n';
import type { Loan, LoanTermsInput } from '../../../../api/loans';

vi.mock('../../../../api/loans', async (orig) => ({
  ...(await orig<typeof import('../../../../api/loans')>()),
  createLoan: vi.fn(),
  updateLoan: vi.fn(),
  simulateLoan: vi.fn(),
}));
import { createLoan, simulateLoan, updateLoan } from '../../../../api/loans';

pinLocale('loans', 'common');

// The preview runs the real engine, so the test sees real numbers.
async function engineSimulate(terms: LoanTermsInput) {
  const r = buildSchedule(terms, '2026-10-16');
  if (!r.ok) throw new ApiError('invalid loan', 422, { error: 'invalid loan', errors: r.errors });
  return { schedule: r.schedule, summary: r.summary, warnings: r.warnings };
}

const filled = (): LoanForm => ({
  ...emptyForm(false, '2026-02-05'),
  name: 'Maison', principal: '200 000', annualRate: '3,5', endDate: '2046-01',
});

function renderEditor(initial: LoanForm, loanId: number | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <LoanEditor title="Nouveau prêt" initial={initial} loanId={loanId} onClose={() => {}} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

beforeEach(() => {
  vi.mocked(simulateLoan).mockReset().mockImplementation(engineSimulate);
  vi.mocked(createLoan).mockReset();
  vi.mocked(updateLoan).mockReset();
});

describe('LoanEditor', () => {
  it('previews the computed payment from French input', async () => {
    renderEditor(emptyForm(false, '2026-02-05'));
    await userEvent.type(screen.getByLabelText('Montant emprunté'), '200 000');
    await userEvent.type(screen.getByLabelText("Taux d'intérêt (% par an)"), '3,5');
    fireEvent.change(screen.getByLabelText('Dernière échéance (mois)'), { target: { value: '2046-01' } });
    expect(await screen.findByText(/1\s?159,92.*par mois/)).toBeInTheDocument();
  });

  it('shows the engine error inline', async () => {
    renderEditor({ ...filled(), solve: 'end_date', finalAmount: '500' });
    expect(await screen.findAllByText(/ne couvre pas les intérêts/)).not.toHaveLength(0);
  });

  it('keeps the form open with a message on a duplicate name (409)', async () => {
    vi.mocked(createLoan).mockRejectedValue(new ApiError('dup', 409, { error: 'a loan with this name already exists' }));
    const { onSaved } = renderEditor(filled());
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Un prêt porte déjà ce nom')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom')).toHaveValue('Maison');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not submit without a name', async () => {
    renderEditor({ ...filled(), name: '' });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Donnez un nom au prêt')).toBeInTheDocument();
    expect(createLoan).not.toHaveBeenCalled();
  });

  it('updates an existing loan', async () => {
    const saved = { id: 4 } as Loan;
    vi.mocked(updateLoan).mockResolvedValue({ loan: saved, summary: (await engineSimulate({
      principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0', insuranceBasis: 'initial',
      fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
    })).summary });
    const { onSaved } = renderEditor(filled(), 4);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(updateLoan).toHaveBeenCalledWith(4, expect.objectContaining({ name: 'Maison', principal: '200000', annualRate: '3.5' }));
  });
});
