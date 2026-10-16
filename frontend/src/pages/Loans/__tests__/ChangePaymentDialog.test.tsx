import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSchedule } from '../../../../../backend/src/domain/loans/engine/index';
import { ChangePaymentDialog } from '../ChangePaymentDialog';
import { pinLocale } from '../../../test/i18n';
import type { Loan, LoanDetail } from '../../../api/loans';

pinLocale('loans', 'common');

const loan: Loan = {
  id: 4, name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
  principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0', insuranceBasis: 'initial',
  fees: '0', periods: [], finalPeriod: { solve: 'payment', endDate: '2046-01' }, earlyRepayments: [],
  createdAt: '', updatedAt: '',
};
const r = buildSchedule(loan, '2026-10-16');
if (!r.ok) throw new Error('fixture');
const detail: LoanDetail = { loan, schedule: r.schedule, summary: r.summary, warnings: [] };

describe('ChangePaymentDialog', () => {
  it('rejects a month outside the loan', async () => {
    const onConfirm = vi.fn();
    render(<ChangePaymentDialog detail={detail} onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('À partir de (mois)'), { target: { value: '2050-01' } });
    await userEvent.type(screen.getByLabelText('Nouvelle mensualité (hors assurance)'), '1 500');
    await userEvent.click(screen.getByRole('button', { name: 'Prévisualiser' }));
    expect(screen.getByText(/Choisissez un mois pendant le prêt/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with split terms', async () => {
    const onConfirm = vi.fn();
    render(<ChangePaymentDialog detail={detail} onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('À partir de (mois)'), { target: { value: '2030-03' } });
    await userEvent.type(screen.getByLabelText('Nouvelle mensualité (hors assurance)'), '1 500');
    await userEvent.click(screen.getByRole('button', { name: 'Prévisualiser' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      finalPeriod: { solve: 'end_date', amount: '1500' },
    }));
  });
});
