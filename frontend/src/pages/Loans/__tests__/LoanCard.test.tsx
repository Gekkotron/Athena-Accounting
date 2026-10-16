import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoanCard } from '../LoanCard';
import type { LoanListItem, LoanSummary } from '../../../api/loans';
import { pinLocale } from '../../../test/i18n';

// Renders in French (repo convention for component tests).
pinLocale('loans');

const summary: LoanSummary = {
  currentPayment: '1159.92', currentPaymentWithInsurance: '1209.92', solvedPayment: '1159.92',
  endDate: '2046-01-05', durationMonths: 240,
  totals: { interest: '78380.80', insurance: '12000.00', fees: '0.00', penalties: '0.00', cost: '90380.80', totalPaid: '290380.80' },
  today: { asOf: '2026-10-16', capitalOwed: '195000.00', repaidPct: 2.5, interestPaid: '4000.00', monthsLeft: 232,
    nextInstalment: { date: '2026-11-05', amount: '1209.92' }, status: 'active' },
};

const loan = (over: Partial<LoanListItem> = {}): LoanListItem => ({
  id: 1, name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0.3',
  insuranceBasis: 'initial', fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2046-01' },
  earlyRepayments: [], createdAt: '', updatedAt: '', summary, ...over,
});

describe('LoanCard', () => {
  it('shows capital owed, progress and opens on click', async () => {
    const onOpen = vi.fn();
    render(<LoanCard loan={loan()} onOpen={onOpen} />);
    expect(screen.getByText('Maison')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    await userEvent.click(screen.getByRole('button', { name: 'Maison' }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('renders a notice instead of numbers when the summary is null', () => {
    render(<LoanCard loan={loan({ summary: null })} onOpen={() => {}} />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('flags simulations', () => {
    render(<LoanCard loan={loan({ isSimulation: true })} onOpen={() => {}} />);
    expect(screen.getByText(/simulation/i)).toBeInTheDocument();
  });
});
