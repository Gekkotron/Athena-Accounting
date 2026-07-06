import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitEditor, type DraftSplit } from '../SplitEditor';
import type { Category } from '../../../api/types';

const cats: Category[] = [
  { id: 10, name: 'Livres',  kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 11, name: 'Électro', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 12, name: 'Divers',  kind: 'neutral', color: null, parentId: null, isDefault: true,  isInternalTransfer: false },
];

function renderEditor(overrides: Partial<React.ComponentProps<typeof SplitEditor>> = {}) {
  const onChange = vi.fn<(splits: DraftSplit[]) => void>();
  const utils = render(
    <SplitEditor
      parentAmountMagnitude={100}
      parentAmountSign={-1}
      initial={[]}
      resetKey="test-1"
      categories={cats}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe('SplitEditor', () => {
  it('shows the "Ventiler" trigger button when initial is empty', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /Ventiler cette transaction/ })).toBeInTheDocument();
    expect(screen.queryByText(/Reste à ventiler/)).not.toBeInTheDocument();
  });

  it('clicking the trigger seeds two rows with a balanced remainder', async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor();
    await user.click(screen.getByRole('button', { name: /Ventiler cette transaction/ }));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toHaveLength(2);
    // First row seeded with half the magnitude, second with the remainder.
    const cents = (m: string) => Math.round(Number(m) * 100);
    expect(cents(last[0].amountMagnitude) + cents(last[1].amountMagnitude)).toBe(100 * 100);
  });

  it('editing a magnitude rebalances the delta into the last row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor({
      initial: [
        { id: 1, transactionId: 1, categoryId: 10, amount: '-40.00', memo: null },
        { id: 2, transactionId: 1, categoryId: 11, amount: '-60.00', memo: null },
      ],
    });
    const firstMagInput = screen.getAllByPlaceholderText(/\d+,\d\d/)[0]; // first "40.00" field
    await user.clear(firstMagInput);
    await user.type(firstMagInput, '55.00');
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0].amountMagnitude).toBe('55.00');
    // Second row snapped to 45.00 (parent 100 - 55).
    expect(last[1].amountMagnitude).toBe('45.00');
    // "Reste à ventiler" chip in sage tone (test the ARIA / class contains 'sage')
    const chip = screen.getByText(/Reste à ventiler/).closest('[data-testid="split-remainder"]')!;
    expect(chip.className).toMatch(/sage/);
  });

  it('mismatch shows a red "Reste à ventiler" chip', async () => {
    const user = userEvent.setup();
    renderEditor({
      initial: [
        { id: 1, transactionId: 1, categoryId: 10, amount: '-40.00', memo: null },
        { id: 2, transactionId: 1, categoryId: 11, amount: '-60.00', memo: null },
      ],
    });
    // Editing the LAST row's magnitude is intentionally not rebalanced (that
    // would double-count), so it's the one edit that can genuinely unbalance
    // the split: 40 + 10 != 100.
    const [, lastMag] = screen.getAllByPlaceholderText(/\d+,\d\d/);
    await user.clear(lastMag);
    await user.type(lastMag, '10.00');
    const chip = screen.getByText(/Reste à ventiler/).closest('[data-testid="split-remainder"]')!;
    expect(chip.className).toMatch(/clay|red/);
  });

  it('renders disabled hint when disabled is true and hides the editor', () => {
    renderEditor({ disabled: true });
    expect(screen.getByText(/virement interne/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ventiler cette transaction/ })).not.toBeInTheDocument();
  });
});
