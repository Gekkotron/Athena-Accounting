import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparatifMensuelSection } from '../ComparatifMensuelSection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});

import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

// The section fetches BOTH /api/reports/categories and /api/categories.
// Route the mock by URL so both queries resolve.
function mockApi(rows: unknown[], categories: unknown[] = []) {
  apiMock.mockImplementation((url: string) => {
    if (url === '/api/reports/categories') return Promise.resolve({ rows });
    if (url === '/api/categories') return Promise.resolve({ categories });
    return Promise.resolve({});
  });
}

function renderSection(currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComparatifMensuelSection currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  // shouldAdvanceTime: without it, @testing-library's findByText/waitFor
  // polling relies on a real setInterval that vitest's fake clock never
  // ticks (testing-library only special-cases Jest's fake timers), so every
  // async assertion below would hang until the test-level timeout.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(Date.UTC(2026, 6, 15))); // 2026-07-15
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ComparatifMensuelSection', () => {
  it('shows the empty state when there are no rows', async () => {
    mockApi([]);
    renderSection();
    expect(await screen.findByText(/pas encore d'historique/i)).toBeInTheDocument();
  });

  it('renders the header with a "mois en cours" indicator', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-06', total: '-100.00' },
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
    ]);
    renderSection();
    expect(await screen.findByText(/Comparatif mensuel/i)).toBeInTheDocument();
    expect(screen.getByText(/mois en cours/i)).toBeInTheDocument();
    expect(screen.getByText(/juillet vs juin/i)).toBeInTheDocument();
  });

  it('renders a category row with current, previous, and delta', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-06', total: '-100.00' },
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
    ]);
    renderSection();
    expect(await screen.findByText('Courses')).toBeInTheDocument();
    // current 150, previous 100, delta +50 (+50,0 %)
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByText(/50,0\s*%/)).toBeInTheDocument();
  });

  it('toggles between Dépenses and Revenus', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
      { category_id: 2, category_name: 'Salaire', category_is_internal_transfer: false, month: '2026-07', total: '2000.00' },
    ]);
    renderSection();
    // Default: expenses → Courses visible, Salaire not.
    expect(await screen.findByText('Courses')).toBeInTheDocument();
    expect(screen.queryByText('Salaire')).not.toBeInTheDocument();
    // Switch to Revenus.
    fireEvent.click(screen.getByRole('button', { name: 'Revenus' }));
    expect(await screen.findByText('Salaire')).toBeInTheDocument();
    expect(screen.queryByText('Courses')).not.toBeInTheDocument();
  });

  it('shows "nouveau" for a category with no previous-month spend', async () => {
    mockApi([
      { category_id: 4, category_name: 'Vacances', category_is_internal_transfer: false, month: '2026-07', total: '-300.00' },
    ]);
    renderSection();
    expect(await screen.findByText(/nouveau/i)).toBeInTheDocument();
  });

  it('shows an error state when the report query fails', async () => {
    apiMock.mockImplementation((url: string) => {
      if (url === '/api/reports/categories') return Promise.reject(new Error('boom'));
      if (url === '/api/categories') return Promise.resolve({ categories: [] });
      return Promise.resolve({});
    });
    renderSection();
    expect(await screen.findByText(/Erreur de chargement/i)).toBeInTheDocument();
  });

  it('renders data when only the colors query fails (report succeeds)', async () => {
    apiMock.mockImplementation((url: string) => {
      if (url === '/api/reports/categories') return Promise.resolve({ rows: [
        { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
      ] });
      if (url === '/api/categories') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });
    renderSection();
    expect(await screen.findByText('Courses')).toBeInTheDocument();
    expect(screen.queryByText(/Erreur de chargement/i)).not.toBeInTheDocument();
  });
});
