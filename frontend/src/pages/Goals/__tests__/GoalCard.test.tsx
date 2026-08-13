import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GoalCard } from '../GoalCard';
import type { SavingsGoal } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

pinLocale('goals');

function mk(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 1, accountId: 1, name: 'Vacances 2027',
    targetAmount: '1000.00', targetDate: '2027-06-01',
    color: null, closedAt: null, currency: 'EUR',
    savedAmount: '400.00', eventCount: 4,
    rawPct: 40, progressPct: 40,
    perMonthNeeded: '55.00', overdueDays: null,
    ...overrides,
  };
}

describe('GoalCard', () => {
  it('renders name, saved / target line and perMonthNeeded when set', () => {
    render(<GoalCard goal={mk()} onOpen={() => {}} />);
    expect(screen.getByText('Vacances 2027')).toBeInTheDocument();
    // The saved/target row is inside a private-blur span
    expect(screen.getByText(/400,00/)).toBeInTheDocument();
    expect(screen.getByText(/1[\s ]?000,00/)).toBeInTheDocument();
    expect(screen.getByText(/55,00/)).toBeInTheDocument();
  });

  it('shows the overdue clause when overdueDays > 0', () => {
    render(<GoalCard goal={mk({ overdueDays: 10, perMonthNeeded: null })} onOpen={() => {}} />);
    expect(screen.getByText(/en retard de 10 jours/)).toBeInTheDocument();
  });

  it('shows the overshoot pct when rawPct > 100', () => {
    render(<GoalCard goal={mk({ rawPct: 108, progressPct: 100 })} onOpen={() => {}} />);
    expect(screen.getByText(/108 % réalisé/)).toBeInTheDocument();
  });

  it('hides perMonthNeeded on closed goals', () => {
    render(<GoalCard goal={mk({ closedAt: '2026-07-01T00:00:00Z' })} onOpen={() => {}} />);
    expect(screen.queryByText(/pour tenir la date/)).not.toBeInTheDocument();
  });

  it('fires onOpen with the goal id when clicked', () => {
    const onOpen = vi.fn();
    render(<GoalCard goal={mk()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
