import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseMutationResult } from '@tanstack/react-query';
import { CategoryRow } from '../CategoryRow';
import type { Category, MatchMode, Rule, SignConstraint } from '../../../api/types';
import type { GroupedEntry } from '../types';

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
  render(
    <CategoryRow
      group={group}
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
});
