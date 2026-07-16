import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseMutationResult } from '@tanstack/react-query';
import { FlatTable } from '../FlatTable';
import type { Category, Rule } from '../../../api/types';
import i18n from '../../../i18n';

// FlatTable renders French strings by default. Preload the 'rules'
// namespace for both locales so `useTranslation` never suspends mid-render,
// then pin the active language to French so the existing French-literal
// assertions below keep matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['rules']);
});

function makeMutation<TVars>(): UseMutationResult<unknown, Error, TVars> {
  return {
    mutate: vi.fn(),
  } as unknown as UseMutationResult<unknown, Error, TVars>;
}

const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 20, name: 'Salaire', kind: 'income', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];

const rule = (id: number, categoryId: number, keyword: string, extras: Partial<Rule> = {}): Rule => ({
  id,
  categoryId,
  keyword,
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  ...extras,
});

function renderTable(rules: Rule[], onRequestDelete = vi.fn()) {
  const updateRule = makeMutation<{ id: number; patch: Partial<Rule> }>();
  render(
    <FlatTable rules={rules} cats={cats} updateRule={updateRule} onRequestDelete={onRequestDelete} />,
  );
  return { updateRule, onRequestDelete };
}

describe('FlatTable', () => {
  it('renders all rules as rows', () => {
    const rules = [rule(1, 10, 'carrefour'), rule(2, 20, 'salaire')];
    renderTable(rules);

    expect(screen.getByDisplayValue('carrefour')).toBeInTheDocument();
    expect(screen.getByDisplayValue('salaire')).toBeInTheDocument();
    expect(screen.getAllByText('Courses').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Salaire').length).toBeGreaterThan(0);
  });

  it('clicking "supprimer" fires onRequestDelete with that rule', async () => {
    const r = rule(1, 10, 'carrefour');
    const user = userEvent.setup();
    const { onRequestDelete } = renderTable([r]);

    await user.click(screen.getByRole('button', { name: 'supprimer' }));

    expect(onRequestDelete).toHaveBeenCalledWith(r);
  });

  it('renders "Aucune règle." when rules is empty', () => {
    renderTable([]);

    expect(screen.getByText('Aucune règle.')).toBeInTheDocument();
  });
});
