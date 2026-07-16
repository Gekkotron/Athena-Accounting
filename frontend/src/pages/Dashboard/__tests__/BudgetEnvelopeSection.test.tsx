import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BudgetEnvelopeSection } from '../BudgetEnvelopeSection';

vi.mock('../../../api/client', () => ({ api: vi.fn() }));
import { api } from '../../../api/client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('BudgetEnvelopeSection', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('renders nothing for a caps-only user (empty report, no pool activity)', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '0.00', assignedCumulative: '0.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '0.00' },
      rows: [],
    });
    const { container } = render(wrap(<BudgetEnvelopeSection />));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it('renders four columns when data exists', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '1000.00', assignedCumulative: '500.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '500.00' },
      rows: [{ categoryId: 1, categoryName: 'A', balancePriorMonth: '0.00', assignment: '500.00',
               spend: '400.00', balance: '100.00', target: null,
               overspendPolicy: 'rollover_negative', overspent: false,
               absorbedByPool: '0.00', monthsToTarget: null }],
    });
    render(wrap(<BudgetEnvelopeSection />));
    expect(await screen.findByText(/Disponible/i)).toBeInTheDocument();
    expect(screen.getByText(/Assigné/i)).toBeInTheDocument();
    expect(screen.getByText(/Sur-budget/i)).toBeInTheDocument();
    expect(screen.getByText(/Retenu/i)).toBeInTheDocument();
  });

  it('shows red styling on the available number when pool is negative', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '100.00', assignedCumulative: '500.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '-400.00' },
      rows: [{ categoryId: 1, categoryName: 'A', balancePriorMonth: '0.00', assignment: '500.00',
               spend: '0.00', balance: '500.00', target: null,
               overspendPolicy: 'rollover_negative', overspent: false,
               absorbedByPool: '0.00', monthsToTarget: null }],
    });
    render(wrap(<BudgetEnvelopeSection />));
    const el = await screen.findByText('−400,00 €');
    expect(el.className).toMatch(/text-clay-300/);
  });
});
