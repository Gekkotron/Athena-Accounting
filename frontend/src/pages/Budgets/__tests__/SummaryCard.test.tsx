import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCard } from '../SummaryCard';

describe('SummaryCard', () => {
  it('renders the hero sentence with spent and limit for monthly period', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: '3180.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Vous avez dépensé/)).toBeInTheDocument();
    expect(screen.getByText(/2\s?340,00/)).toBeInTheDocument();
    expect(screen.getByText(/3\s?000,00/)).toBeInTheDocument();
    expect(screen.getByText(/ce mois-ci/)).toBeInTheDocument();
  });

  it('renders the hero sentence with "cette année" for yearly period', () => {
    render(<SummaryCard
      totals={{ limit: '30000.00', spent: '12000.00', remaining: '18000.00', projected: null }}
      rows={[]}
      period="yearly"
      monthOrYear="2026"
    />);
    expect(screen.getByText(/cette année/)).toBeInTheDocument();
  });

  it('shows the on-track status line when projected is null and remaining is positive', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: null }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Il reste/)).toBeInTheDocument();
    expect(screen.getByText(/d'ici la fin du mois/)).toBeInTheDocument();
    expect(screen.getByText(/660,00/)).toBeInTheDocument();
  });

  it('shows the slipping status line when projected exceeds limit but not yet over', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '2340.00', remaining: '660.00', projected: '3180.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/À ce rythme, vous dépasserez de/)).toBeInTheDocument();
    expect(screen.getByText(/180,00/)).toBeInTheDocument();
  });

  it('shows the over status line when remaining is negative', () => {
    render(<SummaryCard
      totals={{ limit: '3000.00', spent: '3200.00', remaining: '-200.00', projected: '3500.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.getByText(/Vous avez dépassé de/)).toBeInTheDocument();
    // "200,00" also appears in the hero's "3 200,00" — assert it appears at least once.
    expect(screen.getAllByText(/200,00/).length).toBeGreaterThan(0);
  });

  it('does not render the old "Dépassement projeté" pill nor a mini bar chart', () => {
    render(<SummaryCard
      totals={{ limit: '100.00', spent: '80.00', remaining: '20.00', projected: '150.00' }}
      rows={[]}
      period="monthly"
      monthOrYear="2026-07"
    />);
    expect(screen.queryByText(/Dépassement projeté/i)).toBeNull();
    expect(document.querySelectorAll('[data-testid="summary-mini-bar"]').length).toBe(0);
  });

  it('uses the yearly on-track copy for yearly period', () => {
    render(<SummaryCard
      totals={{ limit: '30000.00', spent: '12000.00', remaining: '18000.00', projected: null }}
      rows={[]}
      period="yearly"
      monthOrYear="2026"
    />);
    expect(screen.getByText(/d'ici la fin de l'année/)).toBeInTheDocument();
  });
});
