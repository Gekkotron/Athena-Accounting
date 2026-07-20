import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Tri } from '../Tri';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';

// Tri renders French strings by default and reuses 'common' (loading state).
// Preload both namespaces for both locales, pinned to French, so
// `useTranslation` never suspends and the existing French-literal
// assertions below keep matching real rendered text.
pinLocale('rules', 'tips');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{withTips(<Tri />)}</MemoryRouter>
    </QueryClientProvider>,
  );
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

  it('assign flow: pick a bulk category, select groups, apply → POST /api/tri/assign', async () => {
    const posted: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/tri/groups') {
        return {
          groups: [group('alpha', 3), group('beta', 2)],
          pagination: { total: 2, limit: 200, offset: 0 },
        };
      }
      if (path === '/api/categories') {
        return { categories: [{ id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false }] };
      }
      if (path === '/api/tri/assign' && init?.method === 'POST') {
        posted.push(init.json);
        return { assigned: 3, rulesCreated: 1 };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderTri();
    await screen.findByText('alpha');

    // Pick the bulk category first (top select next to "Catégorie pour la sélection").
    const bulkLabel = screen.getByText(/catégorie pour la sélection/i, { selector: 'label' });
    const bulkSelect = bulkLabel.parentElement!.querySelector('select') as HTMLSelectElement;
    await user.selectOptions(bulkSelect, '10');

    // Select all groups via the "Tout" button.
    await user.click(screen.getByRole('button', { name: /^tout$/i }));

    // Apply.
    await user.click(screen.getByRole('button', { name: /appliquer à/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].groups).toHaveLength(2);
    expect(posted[0].groups.every((g: { categoryId: number }) => g.categoryId === 10)).toBe(true);
    expect(posted[0].createRules).toBe(true); // default checkbox state
  });

  it('recategorize dialog → POST /api/recategorize on confirm', async () => {
    const posted: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/tri/groups') return { groups: [], pagination: { total: 0, limit: 200, offset: 0 } };
      if (path === '/api/categories') return { categories: [] };
      if (path === '/api/recategorize' && init?.method === 'POST') {
        posted.push(init.json);
        return { total: 10, recategorized: 7, unknown: 2, preserved: 1 };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderTri();
    await user.click(await screen.findByRole('button', { name: /recatégoriser l'historique/i }));
    await user.click(await screen.findByRole('button', { name: /^recatégoriser$/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    // Result summary line renders after the recategorize succeeds.
    expect(await screen.findByText(/recatégorisées/i)).toBeInTheDocument();
  });

  it('disables the Apply button when no bulk category is picked', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/tri/groups') {
        return { groups: [group('a', 1)], pagination: { total: 1, limit: 200, offset: 0 } };
      }
      if (path === '/api/categories') return { categories: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const user = userEvent.setup();
    renderTri();
    await screen.findByText('a');
    await user.click(screen.getByRole('button', { name: /^tout$/i }));
    // No bulk category selected → Appliquer disabled.
    expect(screen.getByRole('button', { name: /appliquer à/i })).toBeDisabled();
  });
});
