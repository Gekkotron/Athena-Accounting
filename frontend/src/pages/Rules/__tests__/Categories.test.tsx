import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

function withProviders({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const cat = (id: number, name: string, kind: 'expense' | 'income' | 'neutral' = 'expense', overrides: any = {}) =>
  ({ id, name, kind, color: null, parentId: null, isDefault: false, ...overrides });

// Nested pair used by the grouped-rows tests: Courses (root) + Alimentation (child).
const nestedCats = () => [
  cat(20, 'Courses', 'expense'),
  cat(21, 'Alimentation', 'expense', { parentId: 20 }),
];

function mockNestedCategories() {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: nestedCats() };
    if (path === '/api/reports/categories') return { rows: [] };
    throw new Error(`unexpected: ${path}`);
  });
}

// A root category's name can also show up as the *selected* option inside a
// child row's Parent <select> (e.g. Alimentation's Parent select shows
// "Courses" as selected) — findByDisplayValue alone would then be ambiguous.
// Scope to the actual name <input> to get the row unambiguously.
async function findCategoryNameInput(name: string): Promise<HTMLElement> {
  const matches = await screen.findAllByDisplayValue(name);
  const input = matches.find((el) => el.tagName === 'INPUT');
  if (!input) throw new Error(`no name input found for "${name}"`);
  return input;
}

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

  it('renders a child row indented beneath its parent', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const child = await findCategoryNameInput('Alimentation');
    const parentRow = parent.closest('tr')!;
    const childRow = child.closest('tr')!;
    // Child row appears immediately after its parent row.
    expect(parentRow.nextElementSibling).toBe(childRow);
    // Child row has a data-depth attribute we set for indentation styling.
    expect(childRow.getAttribute('data-depth')).toBe('1');
  });

  it('disables the kind picker on a child row', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const child = await findCategoryNameInput('Alimentation');
    const childRow = child.closest('tr')!;
    const kindSelect = within(childRow).getByRole('combobox', { name: /type/i });
    expect(kindSelect).toBeDisabled();
    expect(kindSelect).toHaveAttribute('title', expect.stringContaining('hérité'));
  });

  it('does not render a Parent column in the table header', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    // The "Parent" <th> was the only cell with the exact text "Parent"; other
    // occurrences ("Parent (optionnel)") were in the create form label, which
    // Task 1 deleted.
    expect(screen.queryByRole('columnheader', { name: /^parent$/i })).not.toBeInTheDocument();
  });

  it('does not render a Parent field in the create form', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    expect(
      screen.queryByRole('combobox', { name: /parent \(optionnel\)/i }),
    ).not.toBeInTheDocument();
  });

  it('appends the "sous-catégories deviendront racines" line to the delete confirm for a parent', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const parentRow = parent.closest('tr')!;
    fireEvent.click(within(parentRow).getByText('supprimer'));
    expect(
      await screen.findByText(/sous-catégories deviendront des catégories racine/i),
    ).toBeInTheDocument();
  });

  it('renders a drag handle button on every row', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    await findCategoryNameInput('Courses');
    // One handle per row (2 rows in the nested fixture).
    const handles = screen.getAllByRole('button', { name: /déplacer la catégorie/i });
    expect(handles).toHaveLength(2);
  });

  it('disables the drag handle on a root that already has children', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const parentRow = parent.closest('tr')!;
    const handle = within(parentRow).getByRole('button', { name: /déplacer la catégorie/i });
    expect(handle).toBeDisabled();
    expect(handle).toHaveAttribute(
      'title',
      expect.stringContaining('sous-catégories'),
    );
  });

  it('leaves the drag handle enabled on a child row', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const child = await findCategoryNameInput('Alimentation');
    const childRow = child.closest('tr')!;
    const handle = within(childRow).getByRole('button', { name: /déplacer la catégorie/i });
    expect(handle).not.toBeDisabled();
  });

  it('inserts a spacer row after each root+children group', async () => {
    mockNestedCategories();
    render(<Categories />, { wrapper: withProviders });
    const parent = await findCategoryNameInput('Courses');
    const childInput = await findCategoryNameInput('Alimentation');
    const parentRow = parent.closest('tr')!;
    const childRow = childInput.closest('tr')!;
    // parent → child → spacer (data-spacer="true", aria-hidden)
    const spacer = childRow.nextElementSibling as HTMLElement | null;
    expect(spacer).not.toBeNull();
    expect(spacer!.tagName).toBe('TR');
    expect(spacer!.getAttribute('data-spacer')).toBe('true');
    expect(spacer!.getAttribute('aria-hidden')).toBe('true');
    // Same for a root without children:
    void parentRow; // silence unused-var if lint complains
  });
});
