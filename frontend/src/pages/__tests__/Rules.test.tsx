import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Rules } from '../Rules';
import { pinLocale } from '../../test/i18n';

// The Rules page renders French strings by default and reuses the shared
// 'common' namespace (AdvancedEditor's Save/Cancel/Delete). Preload both
// namespaces for both locales, pinned to French, so `useTranslation` never
// suspends mid-render and the existing French-literal assertions below keep
// matching real rendered text.
pinLocale('rules');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Rules />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The quick-add form renders plain `<label>` siblings next to the
// `<input>`/`<select>` without a `for`/`id` association, so `getByLabelText`
// cannot find them. This helper walks from the visible label text to its
// containing field wrapper (same pattern as the Accounts characterization
// suite).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
});

const cat = (id: number, name: string, kind: 'expense' | 'income' | 'neutral' = 'expense') => ({
  id, name, kind, color: null, parentId: null, isDefault: false,
});

const rule = (id: number, categoryId: number, keyword: string, extras: Partial<any> = {}) => ({
  id, categoryId, keyword,
  signConstraint: 'any', matchMode: 'word', priority: 0, enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...extras,
});

// The category name also appears as an <option> inside the quick-add and
// advanced-editor <select> elements, so a plain `getByText` collides. This
// matches only the grouped-view category header (a <span>, not an <option>).
function categoryHeader(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'span.font-medium' });
}

describe('Rules page (characterization)', () => {
  it('renders the grouped view with rules grouped by category', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') {
        return { categories: [cat(10, 'Courses'), cat(20, 'Salaire', 'income')] };
      }
      if (path === '/api/rules') {
        return { rules: [
          rule(1, 10, 'carrefour'),
          rule(2, 10, 'monoprix'),
          rule(3, 20, 'salaire'),
        ] };
      }
      throw new Error(`unexpected: ${path}`);
    });

    renderRules();

    await screen.findByText('carrefour');
    expect(categoryHeader('Courses')).toBeInTheDocument();
    expect(categoryHeader('Salaire')).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
    expect(screen.getByText('monoprix')).toBeInTheDocument();
    expect(screen.getByText('salaire')).toBeInTheDocument();
  });

  it('toggles between grouped and flat views', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules') return { rules: [rule(1, 10, 'carrefour')] };
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderRules();
    await screen.findByText('carrefour');

    // Grouped view: category header visible.
    expect(categoryHeader('Courses')).toBeInTheDocument();

    // Switch to flat ("Détaillé").
    await user.click(screen.getByRole('button', { name: /détaillé/i }));

    // Flat view renders a table with a "Mot-clé" column header and the
    // keyword as an editable input's value rather than plain text.
    expect(screen.getByRole('columnheader', { name: 'Mot-clé' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('carrefour')).toBeInTheDocument();

    // Toggle back to grouped ("Par catégorie").
    await user.click(screen.getByRole('button', { name: /par catégorie/i }));
    expect(categoryHeader('Courses')).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
  });

  it('creates a rule via the top form', async () => {
    let created = false;
    const postedBodies: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules' && !init?.method) {
        return { rules: created
          ? [rule(1, 10, 'new-kw')]
          : [] };
      }
      if (path === '/api/rules' && init?.method === 'POST') {
        postedBodies.push(init.json);
        created = true;
        return { rule: rule(1, 10, 'new-kw') };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderRules();

    // Wait for the category to render before interacting with the form.
    await waitFor(() => expect(categoryHeader('Courses')).toBeInTheDocument());

    await user.type(fieldFor('Mot-clé(s)'), 'new-kw');
    await user.selectOptions(fieldFor('Catégorie'), '10');
    await user.click(screen.getByRole('button', { name: /ajouter la règle/i }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toEqual(expect.objectContaining({
      keyword: 'new-kw',
      categoryId: 10,
    }));
    expect(await screen.findByText('new-kw')).toBeInTheDocument();
  });

  it('edits a rule with a PUT body containing only the changed field', async () => {
    const original = rule(1, 10, 'oldkw', { priority: 0 });
    const updated = { ...original, keyword: 'newkw' };
    let edited = false;
    const putBodies: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules' && !init?.method) return { rules: [edited ? updated : original] };
      if (path === '/api/rules/1' && init?.method === 'PUT') {
        putBodies.push(init.json);
        edited = true;
        return { rule: updated };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderRules();
    await screen.findByText('oldkw');

    // The chip's pencil button (aria-label "Modifier") opens the advanced
    // editor modal.
    await user.click(screen.getByRole('button', { name: 'Modifier' }));

    const kwInput = screen.getByDisplayValue('oldkw');
    await user.clear(kwInput);
    await user.type(kwInput, 'newkw');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ keyword: 'newkw' });
    expect(await screen.findByText('newkw')).toBeInTheDocument();
  });

  it('deletes a rule after confirming', async () => {
    let deleted = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules' && !init?.method) return { rules: deleted ? [] : [rule(1, 10, 'doomed')] };
      if (path === '/api/rules/1' && init?.method === 'DELETE') {
        deleted = true;
        return { ok: true };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderRules();
    await screen.findByText('doomed');

    // Switch to the flat view where the delete affordance is a visible
    // "supprimer" text button in the row (the grouped-view chip's delete
    // button only becomes visible on hover, which jsdom does not simulate).
    await user.click(screen.getByRole('button', { name: /détaillé/i }));
    await user.click(screen.getByRole('button', { name: 'supprimer' }));

    // ConfirmDialog appears — click the destructive confirm.
    await user.click(await screen.findByRole('button', { name: 'Supprimer la règle' }));

    await waitFor(() => expect(screen.queryByDisplayValue('doomed')).not.toBeInTheDocument());
  });

  it('bulk-recategorizes after confirming', async () => {
    let recategorized = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules' && !init?.method) return { rules: [rule(1, 10, 'carrefour')] };
      if (path === '/api/recategorize' && init?.method === 'POST') {
        recategorized = true;
        return { total: 42, recategorized: 42, unknown: 0, preserved: 0 };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderRules();
    await screen.findByText('carrefour');

    await user.click(screen.getByRole('button', { name: /recatégoriser l.historique/i }));
    await user.click(await screen.findByRole('button', { name: 'Recatégoriser' }));

    await waitFor(() => expect(recategorized).toBe(true));
  });

  it('renders an empty-state copy when there are no categories or rules', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') return { categories: [] };
      if (path === '/api/rules') return { rules: [] };
      throw new Error(`unexpected: ${path}`);
    });

    renderRules();

    expect(await screen.findByText(/aucune catégorie/i)).toBeInTheDocument();
  });

  it('renders the flat-view empty state when rules is empty', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/rules') return { rules: [] };
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderRules();

    // Switch to flat view.
    await user.click(await screen.findByRole('button', { name: /détaillé/i }));

    expect(await screen.findByText(/aucune règle/i)).toBeInTheDocument();
  });
});
