import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Budgets } from '../index';
import { api } from '../../../api/client';

function withProviders(children: React.ReactNode): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
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
    if (url === '/api/accounts') {
      return { accounts: [{ id: 1, name: 'Compte principal', type: 'checking', currency: 'EUR' }] };
    }
    if (url.startsWith('/api/reports/budget')) {
      return {
        period: 'monthly',
        month: '2026-06',
        windowDays: 30,
        elapsedDays: 15,
        rows: [
          {
            categoryId: 1, name: 'Courses', color: null, accountId: null, period: 'monthly',
            limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false,
            projected: null, history: null, anomaly: false, suggestedLimit: null,
          },
          {
            categoryId: 2, name: 'Alimentation', color: null, accountId: null, period: 'monthly',
            limit: '0.00', currency: 'EUR', spent: '30.00', remaining: '-30.00', pct: 0, over: false,
            projected: null, history: null, anomaly: false, suggestedLimit: null,
          },
        ],
        totals: { limit: '100.00', spent: '80.00', remaining: '20.00', projected: null },
        unbudgetedCandidates: [],
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
  // TODO(Task 7): this used to assert the "Total ce mois-ci" summary block
  // showed the corrected (non-double-counted) total. Task 6 removes that
  // one-line block from the shell — Task 7's SummaryCard reintroduces the
  // corrected total display and should restore an equivalent assertion here.
  it('renders a budgeted parent and child without double-counting anywhere else on the page (total block pending Task 7)', async () => {
    // Parent (Courses) is budgeted at 100€ with 80€ rolled-up spent (which
    // includes the child's 30€). The child (Alimentation) is ALSO budgeted,
    // at 30€, fully spent. A naive sum of row.spent (80 + 30 = 110) would
    // double-count the child's spend inside the parent's rollup.
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (url === '/api/categories') {
        return {
          categories: [
            { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
            { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
          ],
        };
      }
      if (url === '/api/accounts') {
        return { accounts: [{ id: 1, name: 'Compte principal', type: 'checking', currency: 'EUR' }] };
      }
      if (url.startsWith('/api/reports/budget')) {
        return {
          period: 'monthly',
          month: '2026-06',
          windowDays: 30,
          elapsedDays: 15,
          rows: [
            {
              categoryId: 1, name: 'Courses', color: null, accountId: null, period: 'monthly',
              limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false,
              projected: null, history: null, anomaly: false, suggestedLimit: null,
            },
            {
              categoryId: 2, name: 'Alimentation', color: null, accountId: null, period: 'monthly',
              limit: '30.00', currency: 'EUR', spent: '30.00', remaining: '0.00', pct: 100, over: false,
              projected: null, history: null, anomaly: false, suggestedLimit: null,
            },
          ],
          // Server-side aggregate is a naive sum across rows — this is the
          // buggy value a future summary display must NOT show verbatim.
          totals: { limit: '130.00', spent: '110.00', remaining: '20.00', projected: null },
          unbudgetedCandidates: [],
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
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('[data-role="budget-row"]') as HTMLElement;
    const childRow = child.closest('[data-role="budget-row"]') as HTMLElement;
    // Parent row still shows its own rolled-up 80,00 / 100,00, unaffected by
    // the child's separately-budgeted 30,00 — no naive-sum artifact (110,00)
    // leaks into either row.
    expect(within(parentRow).getByText(/80,00.*100,00/)).toBeInTheDocument();
    expect(within(childRow).getByText(/30,00.*30,00/)).toBeInTheDocument();
    expect(screen.queryByText(/110,00/)).not.toBeInTheDocument();
  });
});
