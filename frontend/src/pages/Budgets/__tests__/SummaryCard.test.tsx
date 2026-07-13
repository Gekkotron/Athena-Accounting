import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCard } from '../SummaryCard';

const baseRow = {
  id: 1, categoryId: 1, name: 'X', color: null, accountId: null,
  period: 'monthly' as const, limit: '50.00', currency: 'EUR',
  spent: '20.00', remaining: '30.00', pct: 40, over: false,
  projected: '40.00',
  history: { values: ['10.00', '12.00', '14.00', '16.00', '18.00', '20.00'], average: '15.00', median: '15.00' },
  anomaly: false,
  suggestedLimit: null,
};

describe('SummaryCard', () => {
  it('renders totals and projection', () => {
    render(<SummaryCard
      totals={{ limit: '450.00', spent: '312.40', remaining: '137.60', projected: '685.20' }}
      rows={[baseRow]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/312,40/)).toBeInTheDocument();
    expect(screen.getByText(/450,00/)).toBeInTheDocument();
    expect(screen.getByText(/685,20/)).toBeInTheDocument();
  });

  it('shows a warning label when projected > limit', () => {
    render(<SummaryCard
      totals={{ limit: '100.00', spent: '80.00', remaining: '20.00', projected: '150.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Dépassement projeté/i)).toBeInTheDocument();
  });

  it('hides projection when totals.projected is null', () => {
    render(<SummaryCard
      totals={{ limit: '100.00', spent: '80.00', remaining: '20.00', projected: null }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.queryByText(/Projection/i)).toBeNull();
  });

  it('renders a 6-bar mini chart when rows have history', () => {
    render(<SummaryCard
      totals={{ limit: '50.00', spent: '20.00', remaining: '30.00', projected: '40.00' }}
      rows={[baseRow]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    // Six SVG bars + 1 current-period bar. The current bar has a distinct class.
    const bars = document.querySelectorAll('[data-testid="summary-mini-bar"]');
    expect(bars.length).toBeGreaterThanOrEqual(6);
  });
});
