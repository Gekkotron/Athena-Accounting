import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Plafonds } from '../Plafonds';
import { api } from '../../../api/client';
import { withTips } from '../../../test/renderWithProviders';

function withProviders(children: React.ReactNode, opts?: { initialEntries?: string[] }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={opts?.initialEntries ?? ['/']}>
        {withTips(children as React.ReactElement)}
      </MemoryRouter>
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
            id: 101, categoryId: 1, name: 'Courses', color: null, parentId: null, accountId: null, period: 'monthly',
            limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false,
            projected: null, history: null, anomaly: false, suggestedLimit: null,
          },
          {
            id: 102, categoryId: 2, name: 'Alimentation', color: null, parentId: 1, accountId: null, period: 'monthly',
            limit: '0.00', currency: 'EUR', spent: '30.00', remaining: '-30.00', pct: 0, over: false,
            projected: null, history: null, anomaly: false, suggestedLimit: null,
          },
        ],
        totals: { limit: '100.00', spent: '80.00', remaining: '20.00', projected: null },
        unbudgetedCandidates: [],
      };
    }
    if (url === '/api/budgets') return { budgets: [{ id: 10, categoryId: 1, monthlyLimit: '100.00', currency: 'EUR', period: 'monthly', accountId: null }] };
    throw new Error(`unexpected url ${url}`);
  }),
  ApiError: class ApiError extends Error {},
}));

describe('Budgets page — grouped rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a child budget row indented under its parent budget row', async () => {
    render(withProviders(<Plafonds />));
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('[data-role="budget-row"]') as HTMLElement;
    const childRow = child.closest('[data-role="budget-row"]') as HTMLElement;
    expect(parentRow.nextElementSibling).toBe(childRow);
    expect(childRow.getAttribute('data-depth')).toBe('1');
    // Parent shows the rollup: remaining 20 sur 100 (amounts live in separate spans).
    expect(within(parentRow).getByText(/20,00/)).toBeInTheDocument();
    expect(within(parentRow).getByText(/100,00/)).toBeInTheDocument();
  });
});

describe('Budgets page — totals correction (no double-count)', () => {
  it('renders the SummaryCard with the corrected (non-double-counted) total', async () => {
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
              id: 10, categoryId: 1, name: 'Courses', color: null, parentId: null, accountId: null, period: 'monthly',
              limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false,
              projected: null, history: null, anomaly: false, suggestedLimit: null,
            },
            {
              id: 20, categoryId: 2, name: 'Alimentation', color: null, parentId: 1, accountId: null, period: 'monthly',
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
            { id: 10, categoryId: 1, monthlyLimit: '100.00', currency: 'EUR', period: 'monthly', accountId: null },
            { id: 20, categoryId: 2, monthlyLimit: '30.00', currency: 'EUR', period: 'monthly', accountId: null },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    render(withProviders(<Plafonds />));
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('[data-role="budget-row"]') as HTMLElement;
    const childRow = child.closest('[data-role="budget-row"]') as HTMLElement;
    // Parent row still shows its own rolled-up remaining 20,00 sur 100,00,
    // unaffected by the child's separately-budgeted 30,00 — no naive-sum
    // artifact (110,00) leaks into either row. Amounts live in separate spans
    // so we assert each individually rather than in a single regex.
    expect(within(parentRow).getByText(/20,00/)).toBeInTheDocument();
    expect(within(parentRow).getByText(/100,00/)).toBeInTheDocument();
    // Child is exactly at its limit (spent 30 of 30, remaining 0) — the row
    // shows "Reste 0,00 sur 30,00". Anchor on "^0,00" so the remaining span
    // ("0,00 €") is matched but the limit span ("30,00 €") is not.
    expect(within(childRow).getAllByText(/30,00/).length).toBeGreaterThan(0);
    expect(within(childRow).getByText(/^0,00/)).toBeInTheDocument();
    expect(screen.queryByText(/110,00/)).not.toBeInTheDocument();

    // SummaryCard shows the rollup-aware total: the child's budgeted row is
    // dropped from the sum because its spend already lives inside the
    // parent's rolled-up 80,00 — so the card reads 80,00 sur 100,00, not the
    // server's naive per-row sum (110,00 / 130,00).
    const heroSentence = await screen.findByText(/Vous avez dépensé/);
    const summaryCard = heroSentence.closest('.surface') as HTMLElement;
    expect(within(summaryCard).getByText(/80,00/)).toBeInTheDocument();
    expect(within(summaryCard).getByText(/100,00/)).toBeInTheDocument();
    expect(screen.queryByText(/130,00/)).not.toBeInTheDocument();
  });
});

describe('Budgets page — end-to-end URL + summary', () => {
  it('reads period from URL and renders SummaryCard + UnbudgetedSection + AddBudgetForm', async () => {
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (url === '/api/categories') {
        return { categories: [
          { id: 1, name: 'Loisirs', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
        ] };
      }
      if (url === '/api/accounts') {
        return { accounts: [{ id: 10, name: 'Compte A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' }] };
      }
      if (url.startsWith('/api/reports/budget')) {
        return {
          period: 'yearly',
          year: '2026',
          windowDays: 365,
          elapsedDays: 200,
          rows: [{
            id: 1, categoryId: 1, name: 'Loisirs', color: null, parentId: null, accountId: null,
            period: 'yearly', limit: '600.00', currency: 'EUR',
            spent: '420.00', remaining: '180.00', pct: 70, over: false,
            projected: '766.50',
            history: { values: ['500.00', '450.00', '480.00', '510.00', '520.00', '490.00'], average: '491.67', median: '495.00' },
            anomaly: false,
            suggestedLimit: null,
          }],
          totals: { limit: '600.00', spent: '420.00', remaining: '180.00', projected: '766.50' },
          unbudgetedCandidates: [
            { categoryId: 99, name: 'Vacances', color: null, parentId: null, average: '800.00' },
          ],
        };
      }
      if (url === '/api/budgets') {
        return { budgets: [{ id: 1, categoryId: 1, monthlyLimit: '600.00', currency: 'EUR', period: 'yearly', accountId: null }] };
      }
      throw new Error(`unexpected url ${url}`);
    });

    render(withProviders(<Plafonds />, { initialEntries: ['/?period=yearly&year=2026'] }));

    // Header period label + summary.
    expect(await screen.findByText('2026')).toBeInTheDocument();
    expect(await screen.findByText(/Cette année/i)).toBeInTheDocument();
    // "420,00" and "766,50" each render twice (SummaryCard totals/projection
    // AND the single BudgetRow, since there's only one budgeted category) —
    // assert presence rather than uniqueness.
    expect((await screen.findAllByText(/420,00/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/766,50/)).length).toBeGreaterThan(0);

    // Row (also appears as an <option> in AddBudgetForm's category select
    // once it's no longer the only unbudgeted-for-this-context category —
    // here it's fully budgeted so the row is the sole source, but stay
    // consistent with the AllBy pattern used elsewhere in this file).
    expect((await screen.findAllByText('Loisirs')).length).toBeGreaterThan(0);

    // Unbudgeted (yearly view, 1 candidate → header shows count 1).
    expect(await screen.findByText(/Catégories sans budget \(1\)/)).toBeInTheDocument();

    // Add form present.
    expect(screen.getByText(/Ajouter un budget/)).toBeInTheDocument();
  });
});
