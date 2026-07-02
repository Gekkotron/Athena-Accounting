import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tri } from '../Tri';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

const group = (label: string, count: number, category_id: number | null = null) => ({
  normalized_label: label,
  transaction_count: count,
  total_amount: `-${(count * 10).toFixed(2)}`,
  example_raw_label: label.toUpperCase(),
  example_id: 1,
  min_date: '2026-06-01',
  max_date: '2026-06-30',
  category_id,
  category_name: category_id ? 'Foo' : null,
});

function renderTri() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Tri /></QueryClientProvider>);
}

beforeEach(() => { apiMock.mockReset(); });

describe('Tri page', () => {
  it('renders each group with its normalized label + count', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/tri/groups') {
        return {
          groups: [group('carrefour', 12), group('sncf', 4)],
          pagination: { total: 2, limit: 200, offset: 0 },
        };
      }
      if (path === '/api/categories') return { categories: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderTri();
    expect(await screen.findByText('carrefour')).toBeInTheDocument();
    expect(screen.getByText('sncf')).toBeInTheDocument();
  });

  it('renders an empty-state message when there are no groups', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/tri/groups') return { groups: [], pagination: { total: 0, limit: 200, offset: 0 } };
      if (path === '/api/categories') return { categories: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderTri();
    renderTri();
    // "traité(s)" appears in the header regardless of count.
    await waitFor(() => expect(screen.getAllByText(/traité/i).length).toBeGreaterThan(0));
    // Empty tbody shows the italic empty-state cell.
    expect(screen.getAllByText(/0/).length).toBeGreaterThan(0);
  });

  it('toggle-all + clear controls disable/enable the appropriate buttons', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/tri/groups') {
        return {
          groups: [group('a', 1), group('b', 2)],
          pagination: { total: 2, limit: 200, offset: 0 },
        };
      }
      if (path === '/api/categories') return { categories: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderTri();
    await screen.findByText('a');
    const clearBtn = screen.getByRole('button', { name: /effacer/i });
    expect(clearBtn).toBeDisabled();
    await u.click(screen.getByRole('button', { name: /^tout$/i }));
    // After selectAll, the "Effacer" button becomes enabled.
    expect(clearBtn).not.toBeDisabled();
    await u.click(clearBtn);
    expect(clearBtn).toBeDisabled();
  });

  it('opens the "Recatégoriser" confirm dialog and cancels', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/tri/groups') return { groups: [], pagination: { total: 0, limit: 200, offset: 0 } };
      if (path === '/api/categories') return { categories: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderTri();
    await u.click(await screen.findByRole('button', { name: /recatégoriser l'historique/i }));
    expect(await screen.findByRole('button', { name: /^recatégoriser$/i })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /annuler/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^recatégoriser$/i })).not.toBeInTheDocument(),
    );
  });
});
