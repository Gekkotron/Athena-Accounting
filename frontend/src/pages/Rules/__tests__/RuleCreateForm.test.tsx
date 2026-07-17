import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleCreateForm } from '../RuleCreateForm';
import type { Category } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

// RuleCreateForm renders French strings by default. Preload the 'rules'
// namespace for both locales so `useTranslation` never suspends mid-render,
// then pin the active language to French so the existing French-literal
// assertions below keep matching real rendered text.
pinLocale('rules');

const categories: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];

// The quick-add form renders plain `<label>` siblings next to the
// `<input>`/`<select>` without a `for`/`id` association, so `getByLabelText`
// cannot find them. This helper walks from the visible label text to its
// containing field wrapper (same pattern as the Rules characterization
// suite's `fieldFor` helper).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

describe('RuleCreateForm', () => {
  it('submits with the exact shaped payload when keyword + category are filled', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RuleCreateForm categories={categories} onSubmit={onSubmit} submitting={false} successCount={0} />);

    await user.type(fieldFor('Mot-clé(s)'), 'kw');
    await user.selectOptions(fieldFor('Catégorie'), '10');
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      keywords: ['kw'],
      categoryId: 10,
      signConstraint: 'any',
      matchMode: 'word',
      priority: 0,
    });
  });

  it('does not call onSubmit when the keyword is left empty (native required guard)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RuleCreateForm categories={categories} onSubmit={onSubmit} submitting={false} successCount={0} />);

    await user.selectOptions(fieldFor('Catégorie'), '10');
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSubmit when the category is left unselected (native required guard)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RuleCreateForm categories={categories} onSubmit={onSubmit} submitting={false} successCount={0} />);

    await user.type(fieldFor('Mot-clé(s)'), 'kw');
    await user.click(screen.getByRole('button', { name: 'Ajouter la règle' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resets the keyword field to empty when successCount increments', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <RuleCreateForm categories={categories} onSubmit={onSubmit} submitting={false} successCount={0} />,
    );

    const kwInput = fieldFor('Mot-clé(s)') as HTMLInputElement;
    kwInput.value = 'kw';
    expect(kwInput.value).toBe('kw');

    rerender(<RuleCreateForm categories={categories} onSubmit={onSubmit} submitting={false} successCount={1} />);

    expect((fieldFor('Mot-clé(s)') as HTMLInputElement).value).toBe('');
  });

  it('shows "Ajout…" on the submit button when submitting is true', () => {
    render(<RuleCreateForm categories={categories} onSubmit={vi.fn()} submitting={true} successCount={0} />);

    expect(screen.getByRole('button', { name: 'Ajout…' })).toBeInTheDocument();
  });
});
