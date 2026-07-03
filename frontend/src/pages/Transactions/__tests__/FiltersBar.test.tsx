import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltersBar } from '../FiltersBar';
import type { Account, Category } from '../../../api/types';
import type { Filters } from '../index';

const accs: Account[] = [
  { id: 1, name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
  { id: 2, name: 'B', type: 'savings', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
];
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];

const defaultFilters: Filters = { sort: 'date', order: 'desc' };

// Labels are not wired with for/id, so locate the sibling control by DOM
// proximity instead of getByLabelText.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

function renderBar(overrides: Partial<{
  filters: Filters;
  searchInput: string;
  showAdvanced: boolean;
  onFilterChange: (patch: Partial<Filters>) => void;
  onSearchInputChange: (value: string) => void;
}> = {}) {
  render(
    <FiltersBar
      filters={overrides.filters ?? defaultFilters}
      searchInput={overrides.searchInput ?? ''}
      accounts={accs}
      categories={cats}
      showAdvanced={overrides.showAdvanced ?? true}
      onToggleAdvanced={() => {}}
      onFilterChange={overrides.onFilterChange ?? (() => {})}
      onSearchInputChange={overrides.onSearchInputChange ?? (() => {})}
    />,
  );
}

describe('FiltersBar', () => {
  it('renders account and category dropdowns populated from props', () => {
    renderBar();
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Courses' })).toBeInTheDocument();
  });

  it('fires onFilterChange with a numeric accountId when an account is picked', async () => {
    const onFilterChange = vi.fn();
    const user = userEvent.setup();
    renderBar({ onFilterChange });

    await user.selectOptions(fieldFor('Compte'), '2');

    expect(onFilterChange).toHaveBeenCalledWith({ accountId: 2 });
  });

  it('fires onSearchInputChange synchronously per keystroke (no internal debounce)', async () => {
    const onSearchInputChange = vi.fn();
    const user = userEvent.setup();
    renderBar({ onSearchInputChange });

    await user.type(fieldFor('Recherche'), 'x');

    expect(onSearchInputChange).toHaveBeenCalledWith('x');
  });

  it('applies the hidden md:block classes when showAdvanced is false', () => {
    renderBar({ showAdvanced: false });
    const container = screen.getByText('Recherche').closest('.surface');
    expect(container).toHaveClass('hidden', 'md:block');
  });

  it('does not apply the hidden classes when showAdvanced is true', () => {
    renderBar({ showAdvanced: true });
    const container = screen.getByText('Recherche').closest('.surface');
    expect(container).not.toHaveClass('hidden');
  });
});
