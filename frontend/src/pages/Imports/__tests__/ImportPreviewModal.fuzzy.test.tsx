import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewModal } from '../ImportPreviewModal';
import type { ImportPreview } from '../../../api/imports';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

const preview: ImportPreview = {
  filename: 'juillet.csv',
  format: 'csv',
  accountId: 2,
  totalRows: 3,
  newRows: [
    { date: '2026-07-01', amount: '2000.00', rawLabel: 'Salaire', memo: null },
  ],
  duplicateRows: [
    { date: '2026-07-02', amount: '-10.00', rawLabel: 'Doublon exact', memo: null },
  ],
  fuzzyDuplicateRows: [
    {
      row: { date: '2026-07-03', amount: '-25.31', rawLabel: 'PAIEMENT CARREFOUR REF-98', memo: null },
      parsedIndex: 7,
      matches: [
        { txId: 42, date: '2026-07-01', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET' },
      ],
    },
  ],
};

describe('ImportPreviewModal — fuzzy rows', () => {
  it('renders a "Probable" status for the fuzzy row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Probable')).toBeInTheDocument();
  });

  it('shows a pre-ticked skip checkbox only on the fuzzy row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toBeChecked();
  });

  it('confirming while the box stays ticked sends parsedIndex 7 as skip', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledWith([7]);
  });

  it('un-ticking then confirming sends an empty skip list', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});
