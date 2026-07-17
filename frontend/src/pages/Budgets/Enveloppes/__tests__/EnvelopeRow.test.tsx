import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnvelopeRow } from '../EnvelopeRow';
import { pinLocale } from '../../../../test/i18n';

pinLocale('budgets');

const row = {
  categoryId: 1, categoryName: 'Alimentation',
  balancePriorMonth: '80.00', assignment: '450.00',
  spend: '510.00', balance: '20.00',
  target: null, overspendPolicy: 'rollover_negative' as const,
  overspent: false, absorbedByPool: '0.00', monthsToTarget: null,
};

describe('EnvelopeRow', () => {
  it('renders name, prev, spend, balance', () => {
    render(<EnvelopeRow row={row} onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span>slot</span>} />);
    expect(screen.getByText('Alimentation')).toBeInTheDocument();
    expect(screen.getByText('80,00 €')).toBeInTheDocument();
    expect(screen.getByText('510,00 €')).toBeInTheDocument();
    expect(screen.getByText('20,00 €')).toBeInTheDocument();
  });

  it('shows absorbé chip when overspent under reallocate_manual', () => {
    render(<EnvelopeRow
      row={{ ...row, overspendPolicy: 'reallocate_manual', overspent: true, balance: '0.00', absorbedByPool: '65.00' }}
      onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span />}
    />);
    expect(screen.getByText(/absorbé/i)).toBeInTheDocument();
  });

  it('shows a fill-goal button when a target has a shortfall and fires onFillGoal with the new absolute assignment', () => {
    const spy = vi.fn();
    render(<EnvelopeRow
      row={{
        ...row,
        // Impôts-style: save 1300 € by 2026-09-01. Balance 100, current month 2026-07 →
        // 3 months remaining → delta = 1200 / 3 = 400. New assignment = 450 + 400 = 850.
        target: { amount: '1300.00', date: '2026-09-01', kind: 'save_by_date' },
        assignment: '450.00', balance: '100.00',
      }}
      currentMonth="2026-07"
      onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span />}
      onFillGoal={spy}
    />);
    const btn = screen.getByRole('button', { name: /Assigner 400,00/i });
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 1 }), '850.00');
  });

  it('does not show the fill-goal button when the target is already reached', () => {
    render(<EnvelopeRow
      row={{
        ...row,
        target: { amount: '500.00', date: null, kind: 'save_up_to' },
        balance: '600.00', assignment: '0.00',
      }}
      currentMonth="2026-07"
      onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span />}
      onFillGoal={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: /Assigner/i })).not.toBeInTheDocument();
  });
});
