import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Budgets } from '../index';
import { api } from '../../../api/client';

function withProviders(children: React.ReactNode): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// The `api` module is the project's fetch wrapper (frontend/src/api/client.ts).
// Mock its default export to return canned responses per URL.
vi.mock('../../../api/client', () => ({
  api: vi.fn(async (url: string) => {
    if (url === '/api/categories') {
      return {
        categories: [
          { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
          { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
        ],
      };
    }
    if (url.startsWith('/api/reports/budget')) {
      return {
        month: '2026-06',
        rows: [
          { categoryId: 1, name: 'Courses', color: null, limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false },
          { categoryId: 2, name: 'Alimentation', color: null, limit: '0.00', currency: 'EUR', spent: '30.00', remaining: '-30.00', pct: 0, over: false },
        ],
        totals: { limit: '100.00', spent: '80.00' },
      };
    }
    if (url === '/api/budgets') return { budgets: [{ id: 10, categoryId: 1, monthlyLimit: '100.00', currency: 'EUR' }] };
    throw new Error(`unexpected url ${url}`);
  }),
  ApiError: class ApiError extends Error {},
}));

describe('Budgets page — grouped rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a child budget row indented under its parent budget row', async () => {
    render(withProviders(<Budgets />));
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('[data-role="budget-row"]') as HTMLElement;
    const childRow = child.closest('[data-role="budget-row"]') as HTMLElement;
    expect(parentRow.nextElementSibling).toBe(childRow);
    expect(childRow.getAttribute('data-depth')).toBe('1');
    // Parent shows the rollup 80 / 100.
    expect(within(parentRow).getByText(/80.*100/)).toBeInTheDocument();
  });
});

describe('Budgets page — totals correction (no double-count)', () => {
  it('does not double-count a budgeted child under a budgeted parent in the displayed total', async () => {
    // Parent (Courses) is budgeted at 100€ with 80€ rolled-up spent (which
    // includes the child's 30€). The child (Alimentation) is ALSO budgeted,
    // at 30€, fully spent. A naive sum of row.spent (80 + 30 = 110) would
    // double-count the child's spend inside the parent's rollup — the
    // displayed total must show 80€, not 110€.
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (url === '/api/categories') {
        return {
          categories: [
            { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
            { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
          ],
        };
      }
      if (url.startsWith('/api/reports/budget')) {
        return {
          month: '2026-06',
          rows: [
            { categoryId: 1, name: 'Courses', color: null, limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false },
            { categoryId: 2, name: 'Alimentation', color: null, limit: '30.00', currency: 'EUR', spent: '30.00', remaining: '0.00', pct: 100, over: false },
          ],
          // Server-side aggregate is a naive sum across rows — this is the
          // buggy value the display must NOT show verbatim.
          totals: { limit: '130.00', spent: '110.00' },
        };
      }
      if (url === '/api/budgets') {
        return {
          budgets: [
            { id: 10, categoryId: 1, monthlyLimit: '100.00', currency: 'EUR' },
            { id: 20, categoryId: 2, monthlyLimit: '30.00', currency: 'EUR' },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    render(withProviders(<Budgets />));
    await screen.findByText('Courses');
    const totalLabel = await screen.findByText('Total ce mois-ci');
    const totalRow = totalLabel.closest('div') as HTMLElement;
    expect(within(totalRow).getByText(/80,00/)).toBeInTheDocument();
    expect(within(totalRow).queryByText(/110,00/)).not.toBeInTheDocument();
  });
});
