import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseMutationResult } from '@tanstack/react-query';
import { GroupedView } from '../GroupedView';
import type { Category, MatchMode, Rule, SignConstraint } from '../../../api/types';
import type { GroupedEntry } from '../types';

function makeMutation<TData, TVars>(): UseMutationResult<TData, Error, TVars> {
  return {
    mutate: vi.fn(),
  } as unknown as UseMutationResult<TData, Error, TVars>;
}

type CreateBatchVars = {
  keywords: string[];
  categoryId: number;
  signConstraint: SignConstraint;
  matchMode: MatchMode;
  priority: number;
};

const cat = (id: number, name: string): Category => ({
  id,
  name,
  kind: 'expense',
  color: null,
  parentId: null,
  isDefault: false,
  isInternalTransfer: false,
});

const rule = (id: number, categoryId: number, keyword: string): Rule => ({
  id,
  categoryId,
  keyword,
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
});

function renderView(grouped: GroupedEntry[]) {
  const createBatch = makeMutation<number, CreateBatchVars>();
  const updateRule = makeMutation<unknown, { id: number; patch: Partial<Rule> }>();
  const byId = new Map<number, Category>(grouped.map((g) => [g.category.id, g.category]));
  render(
    <GroupedView
      grouped={grouped}
      byId={byId}
      createBatch={createBatch}
      updateRule={updateRule}
      onRequestDelete={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
}

describe('GroupedView', () => {
  it('renders one CategoryRow per entry in grouped', () => {
    const grouped: GroupedEntry[] = [
      { category: cat(10, 'Courses'), rules: [rule(1, 10, 'carrefour')] },
      { category: cat(20, 'Salaire'), rules: [rule(2, 20, 'salaire')] },
    ];
    renderView(grouped);

    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('Salaire')).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
    expect(screen.getByText('salaire')).toBeInTheDocument();
  });

  it('renders the empty-state message when grouped is empty', () => {
    renderView([]);

    expect(
      screen.getByText("Aucune catégorie. Créez-en une dans l'onglet « Catégories »."),
    ).toBeInTheDocument();
  });
});
