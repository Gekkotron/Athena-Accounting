import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Budgets } from '../Budgets';

// Mock the api client so the page renders deterministic data.
vi.mock('../../api/client', () => ({
  api: vi.fn((path: string) => {
    if (path === '/api/budgets') return Promise.resolve({ budgets: [{ id: 1, categoryId: 10, monthlyLimit: '300.00', currency: 'EUR' }] });
    if (path === '/api/reports/budget') return Promise.resolve({
      month: '2025-03',
      rows: [{ categoryId: 10, name: 'Restaurants', color: null, limit: '300.00', currency: 'EUR', spent: '240.00', remaining: '60.00', pct: 80, over: false }],
      totals: { limit: '300.00', spent: '240.00' },
    });
    if (path === '/api/categories') return Promise.resolve({ categories: [{ id: 10, name: 'Restaurants', kind: 'expense' }] });
    return Promise.resolve({});
  }),
  ApiError: class extends Error {},
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Budgets /></QueryClientProvider>);
}

describe('Budgets page', () => {
  it('renders a budgeted category row with spent / limit', async () => {
    renderPage();
    expect(await screen.findByText('Restaurants')).toBeInTheDocument();
    // formatAmount renders "240,00 €" (with a non-breaking space) and the
    // amount appears twice (the totals bar + the row) — match on the
    // leading digits and assert at least one occurrence rather than one.
    expect((await screen.findAllByText(/240/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/reste/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no budgets', async () => {
    const { api } = await import('../../api/client');
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/api/reports/budget') return Promise.resolve({ month: '2025-03', rows: [], totals: { limit: '0.00', spent: '0.00' } });
      if (path === '/api/budgets') return Promise.resolve({ budgets: [] });
      if (path === '/api/categories') return Promise.resolve({ categories: [] });
      return Promise.resolve({});
    });
    renderPage();
    expect(await screen.findByText(/aucun budget/i)).toBeInTheDocument();
  });
});
