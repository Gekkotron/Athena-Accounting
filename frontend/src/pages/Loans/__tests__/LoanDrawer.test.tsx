import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildSchedule } from '../../../../../backend/src/domain/loans/engine/index';
import { LoanDrawer } from '../LoanDrawer';
import { pinLocale } from '../../../test/i18n';
import type { Loan, LoanDetail } from '../../../api/loans';

vi.mock('../../../api/loans', async (orig) => ({
  ...(await orig<typeof import('../../../api/loans')>()),
  getLoan: vi.fn(),
  deleteLoan: vi.fn(),
}));
import { deleteLoan, getLoan } from '../../../api/loans';

pinLocale('loans', 'common');

const loan: Loan = {
  id: 4, name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '200000.00', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0.3',
  insuranceBasis: 'initial', fees: '0', periods: [{ kind: 'partial_deferral', months: 12 }],
  finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
  createdAt: '', updatedAt: '',
};

function detail(): LoanDetail {
  const res = buildSchedule(loan, '2026-10-16');
  if (!res.ok) throw new Error('fixture invalid');
  return { loan, schedule: res.schedule, summary: res.summary, warnings: res.warnings };
}

function renderDrawer(props: Partial<Parameters<typeof LoanDrawer>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <LoanDrawer id={4} onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.mocked(getLoan).mockReset();
  vi.mocked(deleteLoan).mockReset();
});

describe('LoanDrawer', () => {
  it('shows the summary, the periods and the schedule', async () => {
    vi.mocked(getLoan).mockResolvedValue(detail());
    renderDrawer();
    expect(await screen.findByRole('heading', { name: 'Maison' })).toBeInTheDocument();
    expect(screen.getByText('Capital restant dû')).toBeInTheDocument();
    expect(screen.getByText('Différé partiel')).toBeInTheDocument();
    expect(screen.getByText('calculé')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Capital restant dû/ })).toBeInTheDocument();
    expect(screen.getByText('2046')).toBeInTheDocument(); // last schedule year group
  });

  it('shows a notice when the stored terms are invalid', async () => {
    vi.mocked(getLoan).mockResolvedValue({ loan, schedule: [], summary: null, warnings: [], errors: [{ code: 'too_long' }] });
    renderDrawer();
    expect(await screen.findByRole('alert')).toHaveTextContent(/calculateur refuse/);
    expect(screen.queryByText('Tableau d\'amortissement')).toBeNull();
  });

  it('deletes after confirmation and closes', async () => {
    vi.mocked(getLoan).mockResolvedValue(detail());
    vi.mocked(deleteLoan).mockResolvedValue({ ok: true });
    const { onClose } = renderDrawer();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getAllByRole('dialog').at(-1)!;
    expect(dialog).toHaveTextContent(/Supprimer ce prêt/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(deleteLoan).toHaveBeenCalledWith(4);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders an action button only when its callback is given', async () => {
    vi.mocked(getLoan).mockResolvedValue(detail());
    const onEdit = vi.fn();
    renderDrawer({ onEdit });
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ loan }));
    expect(screen.queryByRole('button', { name: 'Et si…' })).toBeNull();
  });
});
