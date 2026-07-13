import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SuggestionCard } from '../SuggestionCard';

const rowOver = {
  id: 5, categoryId: 42, name: 'Restaurants', color: null, accountId: null,
  period: 'monthly' as const, limit: '50.00', currency: 'EUR',
  spent: '75.00', remaining: '-25.00', pct: 150, over: true,
  projected: '75.00',
  history: { values: ['62.15', '55.30', '58.90', '65.10', '61.80', '72.25'], average: '62.58', median: '62.00' },
  anomaly: false, suggestedLimit: '62.00',
};
const rowUnder = { ...rowOver, spent: '5.00', remaining: '45.00', pct: 10, over: false, suggestedLimit: '15.00' };

beforeEach(() => localStorage.clear());

describe('SuggestionCard', () => {
  it('renders chronic-over copy and Ajuster button', () => {
    render(<SuggestionCard row={rowOver} budgetId={5} periodKey="2026-07" onApply={() => {}} />);
    expect(screen.getByText(/dépasse depuis/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ajuster à 62,00/ })).toBeInTheDocument();
  });

  it('renders chronic-under copy when suggestedLimit < limit', () => {
    render(<SuggestionCard row={rowUnder} budgetId={5} periodKey="2026-07" onApply={() => {}} />);
    expect(screen.getByText(/sous le plafond/i)).toBeInTheDocument();
  });

  it('calls onApply(budgetId, suggestedLimit) when Ajuster is clicked', () => {
    const onApply = vi.fn();
    render(<SuggestionCard row={rowOver} budgetId={5} periodKey="2026-07" onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Ajuster à/ }));
    expect(onApply).toHaveBeenCalledWith(5, '62.00');
  });

  it('hides the card after Ignorer and persists that dismissal in localStorage', () => {
    const { rerender, container } = render(
      <SuggestionCard row={rowOver} budgetId={5} periodKey="2026-07" onApply={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ignorer/ }));
    expect(container.textContent).toBe('');
    rerender(<SuggestionCard row={rowOver} budgetId={5} periodKey="2026-07" onApply={() => {}} />);
    expect(container.textContent).toBe('');
    const dismissed = JSON.parse(localStorage.getItem('budget-suggestions-dismissed-2026-07') ?? '[]');
    expect(dismissed).toContain(42);
  });

  it('does not render when suggestedLimit is null', () => {
    const { container } = render(<SuggestionCard
      row={{ ...rowOver, suggestedLimit: null }}
      budgetId={5} periodKey="2026-07" onApply={() => {}}
    />);
    expect(container.textContent).toBe('');
  });

  it('uses a fresh localStorage bucket per periodKey (dismissal in July does not carry to August)', () => {
    localStorage.setItem('budget-suggestions-dismissed-2026-07', JSON.stringify([42]));
    render(<SuggestionCard row={rowOver} budgetId={5} periodKey="2026-08" onApply={() => {}} />);
    expect(screen.getByRole('button', { name: /Ajuster à/ })).toBeInTheDocument();
  });

  it('reappears after an in-place period switch on the same mounted instance (no remount)', () => {
    // index.tsx keeps this component's key stable across period navigation
    // (it does not include periodKey), so React reuses the same instance
    // instead of remounting when the user flips from July to August.
    const { rerender } = render(
      <SuggestionCard row={rowOver} budgetId={5} periodKey="2026-07" onApply={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ignorer/ }));
    expect(screen.queryByRole('button', { name: /Ajuster à/ })).not.toBeInTheDocument();

    rerender(<SuggestionCard row={rowOver} budgetId={5} periodKey="2026-08" onApply={() => {}} />);
    expect(screen.getByRole('button', { name: /Ajuster à/ })).toBeInTheDocument();
  });
});
