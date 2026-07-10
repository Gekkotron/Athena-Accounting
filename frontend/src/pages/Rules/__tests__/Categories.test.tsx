import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Categories } from '../Categories';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Categories /></QueryClientProvider>);
}

const cat = (id: number, name: string, kind: 'expense' | 'income' | 'neutral' = 'expense', overrides: any = {}) =>
  ({ id, name, kind, color: null, parentId: null, isDefault: false, ...overrides });

beforeEach(() => { apiMock.mockReset(); });

describe('Categories page', () => {
  it('renders the category list with kind badges', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') {
        return {
          categories: [
            cat(1, 'Courses', 'expense'),
            cat(2, 'Salaire', 'income'),
            cat(3, 'Divers', 'neutral', { isDefault: true }),
          ],
        };
      }
      if (path === '/api/reports/categories') return { rows: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderPage();
    // Names are rendered inside <input defaultValue>, not text nodes.
    expect(await screen.findByDisplayValue('Courses')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Salaire')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Divers')).toBeInTheDocument();
    // Kind badges next to each row's kind select. The badge span is
    // rendered alongside every row's kind, so the count includes both the
    // badge + the select's active <option> text.
    expect(screen.getAllByText(/dépense/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/revenu/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/neutre/i).length).toBeGreaterThan(0);
  });

  it('POSTs a new category when the create form is submitted', async () => {
    const posted: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories' && !init) return { categories: [] };
      if (path === '/api/reports/categories') return { rows: [] };
      if (path === '/api/categories' && init?.method === 'POST') {
        posted.push(init.json);
        return { category: { ...init.json, id: 99 } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /ajouter/i });

    // Labels aren't associated to inputs via htmlFor, so pick the sole
    // required text input (the create form's "Nom" field).
    const nameInputs = screen.getAllByRole('textbox');
    await user.type(nameInputs[0]!, 'Nouvelle');
    await user.click(screen.getByRole('button', { name: /ajouter/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ name: 'Nouvelle', kind: 'expense' });
  });

  it('PUTs a rename when a category name is edited and blurred', async () => {
    const puts: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories' && !init) {
        return { categories: [cat(1, 'Old')] };
      }
      if (path === '/api/reports/categories') return { rows: [] };
      if (path === '/api/categories/1' && init?.method === 'PUT') {
        puts.push(init.json);
        return { category: { ...cat(1, 'Old'), ...init.json } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPage();
    const oldInput = await screen.findByDisplayValue('Old');
    await user.clear(oldInput);
    await user.type(oldInput, 'New');
    oldInput.blur();

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ name: 'New' });
  });

  it('opens the confirm dialog on delete and DELETEs on confirm', async () => {
    let deleted = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories' && !init) {
        return { categories: deleted ? [] : [cat(7, 'Deletable')] };
      }
      if (path === '/api/reports/categories') return { rows: [] };
      if (path === '/api/categories/7' && init?.method === 'DELETE') {
        deleted = true;
        return { ok: true };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByDisplayValue('Deletable');

    await user.click(screen.getByRole('button', { name: /^supprimer$/i }));
    await user.click(await screen.findByRole('button', { name: /supprimer la catégorie/i }));

    await waitFor(() =>
      expect(screen.queryByDisplayValue('Deletable')).not.toBeInTheDocument(),
    );
  });

  it('hides the delete button for the default category', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') {
        return { categories: [cat(1, 'Divers', 'neutral', { isDefault: true }), cat(2, 'Loisirs')] };
      }
      if (path === '/api/reports/categories') return { rows: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderPage();
    await screen.findByDisplayValue('Divers');
    // Only one "supprimer" button visible — the one for Loisirs.
    const dels = screen.getAllByRole('button', { name: /^supprimer$/i });
    expect(dels).toHaveLength(1);
  });
});
