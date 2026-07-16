import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseMutationResult } from '@tanstack/react-query';
import { CategoryRow } from '../CategoryRow';
import type { Category, MatchMode, Rule, SignConstraint } from '../../../api/types';
import type { GroupedEntry } from '../types';
import i18n from '../../../i18n';

// CategoryRow renders French strings by default and nests Chip (which uses
// the shared 'common' namespace for its Modifier/Supprimer buttons).
// Preload both namespaces for both locales, pinned to French, so the
// existing French-literal assertions below keep matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['rules', 'common']);
});

function makeMutation<TData, TVars>(): UseMutationResult<TData, Error, TVars> {
  return {
    mutate: vi.fn(),
  } as unknown as UseMutationResult<TData, Error, TVars>;
}

const category: Category = {
  id: 10,
  name: 'Courses',
  kind: 'expense',
  color: null,
  parentId: null,
  isDefault: false,
  isInternalTransfer: false,
};

const rule = (id: number, keyword: string, extras: Partial<Rule> = {}): Rule => ({
  id,
  categoryId: category.id,
  keyword,
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...extras,
});

type CreateBatchVars = {
  keywords: string[];
  categoryId: number;
  signConstraint: SignConstraint;
  matchMode: MatchMode;
  priority: number;
};

function renderRow(group: GroupedEntry, overrides: Partial<{
  onRequestDelete: (rule: Rule) => void;
  onEdit: (rule: Rule) => void;
}> = {}) {
  const createBatch = makeMutation<number, CreateBatchVars>();
  const updateRule = makeMutation<unknown, { id: number; patch: Partial<Rule> }>();
  const onRequestDelete = overrides.onRequestDelete ?? vi.fn();
  const onEdit = overrides.onEdit ?? vi.fn();
  const byId = new Map<number, Category>([[group.category.id, group.category]]);
  render(
    <CategoryRow
      group={group}
      byId={byId}
      createBatch={createBatch}
      updateRule={updateRule}
      onRequestDelete={onRequestDelete}
      onEdit={onEdit}
    />,
  );
  return { createBatch, updateRule, onRequestDelete, onEdit };
}

describe('CategoryRow', () => {
  it('renders the category name and a Chip per rule', () => {
    const group: GroupedEntry = {
      category,
      rules: [rule(1, 'carrefour'), rule(2, 'monoprix')],
    };
    renderRow(group);

    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
    expect(screen.getByText('monoprix')).toBeInTheDocument();
  });

  it('clicking a chip keyword toggles enabled via updateRule.mutate', async () => {
    const group: GroupedEntry = { category, rules: [rule(1, 'carrefour', { enabled: true })] };
    const user = userEvent.setup();
    const { updateRule } = renderRow(group);

    await user.click(screen.getByText('carrefour'));

    expect(updateRule.mutate).toHaveBeenCalledWith({ id: 1, patch: { enabled: false } });
  });

  it('clicking "Modifier" on a chip calls onEdit with that rule', async () => {
    const r = rule(1, 'carrefour');
    const group: GroupedEntry = { category, rules: [r] };
    const user = userEvent.setup();
    const { onEdit } = renderRow(group);

    await user.click(screen.getByRole('button', { name: 'Modifier' }));

    expect(onEdit).toHaveBeenCalledWith(r);
  });

  it('clicking "Supprimer" on a chip calls onRequestDelete with that rule', async () => {
    const r = rule(1, 'carrefour');
    const group: GroupedEntry = { category, rules: [r] };
    const user = userEvent.setup();
    const { onRequestDelete } = renderRow(group);

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    expect(onRequestDelete).toHaveBeenCalledWith(r);
  });

  it('shows "aucun mot-clé" when there are no rules', () => {
    const group: GroupedEntry = { category, rules: [] };
    renderRow(group);

    expect(screen.getByText('aucun mot-clé')).toBeInTheDocument();
  });

  it('renders a colored kind badge next to the category name', () => {
    const group: GroupedEntry = { category: { ...category, kind: 'income' }, rules: [] };
    renderRow(group);
    // KIND_LABEL['income'] = 'Revenu'.
    expect(screen.getByText('Revenu')).toBeInTheDocument();
  });

  it('"tout activer" fires updateRule for every disabled rule only', async () => {
    const group: GroupedEntry = {
      category,
      rules: [
        rule(1, 'carrefour', { enabled: false }),
        rule(2, 'monoprix', { enabled: false }),
        rule(3, 'lidl', { enabled: true }),
      ],
    };
    const user = userEvent.setup();
    const { updateRule } = renderRow(group);
    await user.click(screen.getByRole('button', { name: /tout activer/i }));
    // Two disabled → two mutations. The enabled one is skipped.
    expect(updateRule.mutate).toHaveBeenCalledTimes(2);
    expect(updateRule.mutate).toHaveBeenCalledWith({ id: 1, patch: { enabled: true } });
    expect(updateRule.mutate).toHaveBeenCalledWith({ id: 2, patch: { enabled: true } });
  });

  it('"désactiver tout" fires updateRule for every enabled rule only', async () => {
    const group: GroupedEntry = {
      category,
      rules: [
        rule(1, 'carrefour', { enabled: true }),
        rule(2, 'monoprix', { enabled: false }),
      ],
    };
    const user = userEvent.setup();
    const { updateRule } = renderRow(group);
    await user.click(screen.getByRole('button', { name: /désactiver tout/i }));
    expect(updateRule.mutate).toHaveBeenCalledTimes(1);
    expect(updateRule.mutate).toHaveBeenCalledWith({ id: 1, patch: { enabled: false } });
  });

  it('opens the AddChipInput and submits a comma-separated list of keywords', async () => {
    const group: GroupedEntry = { category, rules: [] };
    const user = userEvent.setup();
    const { createBatch } = renderRow(group);

    await user.click(screen.getByRole('button', { name: /\+ ajouter/i }));
    const input = screen.getByPlaceholderText(/dentiste/i);
    await user.type(input, 'dentiste, pharma, medecin{Enter}');

    expect(createBatch.mutate).toHaveBeenCalledWith({
      keywords: ['dentiste', 'pharma', 'medecin'],
      categoryId: category.id,
      signConstraint: 'negative', // expense → default sign is negative
      matchMode: 'word',
      priority: 0,
    });
  });

  it('picks the correct default sign for income categories', async () => {
    const group: GroupedEntry = {
      category: { ...category, id: 20, name: 'Salaire', kind: 'income' },
      rules: [],
    };
    const user = userEvent.setup();
    const { createBatch } = renderRow(group);

    await user.click(screen.getByRole('button', { name: /\+ ajouter/i }));
    const input = screen.getByPlaceholderText(/dentiste/i);
    await user.type(input, 'employeur{Enter}');

    expect(createBatch.mutate).toHaveBeenCalledWith(expect.objectContaining({ signConstraint: 'positive' }));
  });

  it('Escape in the AddChipInput cancels without firing', async () => {
    const group: GroupedEntry = { category, rules: [] };
    const user = userEvent.setup();
    const { createBatch } = renderRow(group);

    await user.click(screen.getByRole('button', { name: /\+ ajouter/i }));
    const input = screen.getByPlaceholderText(/dentiste/i);
    await user.type(input, 'ignore me{Escape}');

    expect(createBatch.mutate).not.toHaveBeenCalled();
    // The input closes; the "+ ajouter" button is back.
    expect(await screen.findByRole('button', { name: /\+ ajouter/i })).toBeInTheDocument();
  });
});
