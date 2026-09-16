import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleSplitEditor, type SplitDraft } from '../RuleSplitEditor';
import { pinLocale } from '../../../test/i18n';
import type { Category } from '../../../api/types';

pinLocale('rules');

const CATS: Category[] = [
  { id: 1, name: 'Livres',     kind: 'expense', color: '#000', parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 2, name: 'Electro',    kind: 'expense', color: '#000', parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 3, name: 'Musique',    kind: 'expense', color: '#000', parentId: null, isDefault: false, isInternalTransfer: false },
];

function setup(initial?: SplitDraft[]) {
  const onChange = vi.fn<(state: { splits: SplitDraft[]; valid: boolean }) => void>();
  render(<RuleSplitEditor categories={CATS} initial={initial} onChange={onChange} />);
  return { onChange };
}

describe('RuleSplitEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds two empty rows on mount when no initial value is provided', () => {
    setup();
    const rowCategoryPickers = screen.getAllByLabelText(/^Catégorie$/i);
    const rowPercentInputs = screen.getAllByRole('spinbutton');
    expect(rowCategoryPickers).toHaveLength(2);
    expect(rowPercentInputs).toHaveLength(2);
  });

  it('renders provided initial rows and reports valid=true when sum=100', () => {
    const { onChange } = setup([
      { categoryId: 1, percent: 70 },
      { categoryId: 2, percent: 30 },
    ]);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    // The last onChange call after mount reports the initial state.
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.valid).toBe(true);
    expect(last.splits).toEqual([
      { categoryId: 1, percent: 70 },
      { categoryId: 2, percent: 30 },
    ]);
  });

  it('flags valid=false when the sum is not 100', async () => {
    const u = userEvent.setup();
    const { onChange } = setup([
      { categoryId: 1, percent: 60 },
      { categoryId: 2, percent: 30 },
    ]);
    // Sum indicator shows 90 with the amber "must be 100" copy.
    expect(screen.getByText(/Somme : 90/i)).toBeInTheDocument();
    expect(screen.getByText(/exactement 100/i)).toBeInTheDocument();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.valid).toBe(false);
    void u;
  });

  it('adds a row when clicking "Ajouter une catégorie"', async () => {
    const u = userEvent.setup();
    setup();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    await u.click(screen.getByRole('button', { name: /ajouter une catégorie/i }));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });

  it('removes a row when clicking Retirer, down to the 2-row minimum', async () => {
    const u = userEvent.setup();
    setup([
      { categoryId: 1, percent: 50 },
      { categoryId: 2, percent: 25 },
      { categoryId: 3, percent: 25 },
    ]);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    const removeButtons = screen.getAllByRole('button', { name: /retirer/i });
    await u.click(removeButtons[0]!);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    // At 2 rows, Retirer buttons hide (min = 2).
    expect(screen.queryAllByRole('button', { name: /retirer/i })).toHaveLength(0);
  });

  it('rejects a 21st row (max 20)', async () => {
    const u = userEvent.setup();
    // Start at 20 rows: 5 * 20% = 100%; then 20 * 5% = 100%.
    const init: SplitDraft[] = Array.from({ length: 20 }, (_, i) => ({
      categoryId: CATS[i % CATS.length]!.id,
      percent: 5,
    }));
    setup(init);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(20);
    // The add button disables at 20 rows.
    expect(screen.getByRole('button', { name: /ajouter une catégorie/i })).toBeDisabled();
    void u;
  });

  it('emits {splits, valid} on percent change', async () => {
    const u = userEvent.setup();
    const { onChange } = setup([
      { categoryId: 1, percent: 40 },
      { categoryId: 2, percent: 60 },
    ]);
    const percentInputs = screen.getAllByRole('spinbutton');
    await u.clear(percentInputs[0]!);
    await u.type(percentInputs[0]!, '50');
    // Now 50 + 60 = 110 → invalid.
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.valid).toBe(false);
    expect(last.splits[0]!.percent).toBe(50);
  });
});
