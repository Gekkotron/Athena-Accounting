import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Enveloppes } from '../Enveloppes';
import { withTips } from '../../../../test/renderWithProviders';
import { pinLocale } from '../../../../test/i18n';

vi.mock('../../../../api/client', () => ({ api: vi.fn() }));
import { api } from '../../../../api/client';

pinLocale('budgets', 'tips');

const report = {
  month: '2026-07',
  pool: { incomeCumulative: '1000.00', assignedCumulative: '300.00',
          heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '700.00' },
  rows: [{ categoryId: 1, categoryName: 'Alimentation',
           balancePriorMonth: '0.00', assignment: '300.00', spend: '100.00',
           balance: '200.00', target: null,
           overspendPolicy: 'rollover_negative', overspent: false,
           absorbedByPool: '0.00', monthsToTarget: null }],
};

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={['/budgets/envelopes?month=2026-07']}>
      {withTips(children as React.ReactElement)}
    </MemoryRouter>
  </QueryClientProvider>;
}

describe('Enveloppes page', () => {
  beforeEach(() => { vi.mocked(api).mockReset(); });

  it('renders the report and the assignment input', async () => {
    vi.mocked(api).mockImplementation((url: string) => {
      if (url.includes('/report')) return Promise.resolve(report);
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    expect(await screen.findByText('Alimentation')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/300/)).toBeInTheDocument();
  });

  it('sends PUT /api/envelopes/assignments on blur with new amount', async () => {
    vi.mocked(api).mockImplementation((url: string, opts?: { method?: string; json?: unknown }) => {
      if (opts?.method === 'PUT') return Promise.resolve({ assignment: {} });
      if (url.includes('/report')) return Promise.resolve(report);
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    const input = await screen.findByDisplayValue(/300/);
    fireEvent.change(input, { target: { value: '400,00' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(vi.mocked(api)).toHaveBeenCalledWith('/api/envelopes/assignments', expect.objectContaining({
        method: 'PUT', json: expect.objectContaining({ categoryId: 1, month: '2026-07', amount: '400.00' }),
      })),
    );
  });

  it('shows empty-state CTA when the report has no rows', async () => {
    vi.mocked(api).mockImplementation((url: string) => {
      if (url.includes('/report')) return Promise.resolve({
        month: '2026-07',
        pool: { incomeCumulative: '0.00', assignedCumulative: '0.00',
                heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '0.00' },
        rows: [],
      });
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    expect(await screen.findByText(/Aucune enveloppe/i)).toBeInTheDocument();
  });

  it('shows negative-pool banner when available < 0', async () => {
    vi.mocked(api).mockImplementation((url: string) => {
      if (url.includes('/report')) return Promise.resolve({
        month: '2026-07',
        pool: { incomeCumulative: '100.00', assignedCumulative: '500.00',
                heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '-400.00' },
        rows: [],
      });
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    expect(await screen.findByText(/sur-budgété/i)).toBeInTheDocument();
  });

  it('surfaces Non budgétées section when a category has spend but no envelope', async () => {
    vi.mocked(api).mockImplementation((url: string) => {
      if (url.includes('/report')) return Promise.resolve({
        month: '2026-07',
        pool: { incomeCumulative: '1000.00', assignedCumulative: '0.00',
                heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '1000.00' },
        rows: [{ categoryId: 42, categoryName: 'Restaurants',
                 balancePriorMonth: '0.00', assignment: '0.00', spend: '80.00',
                 balance: '-80.00', target: null,
                 overspendPolicy: 'rollover_negative', overspent: true,
                 absorbedByPool: '0.00', monthsToTarget: null }],
      });
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    expect(await screen.findByText(/Non budgétées ce mois \(1\)/)).toBeInTheDocument();
  });
});
