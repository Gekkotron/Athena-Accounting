import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckpointRow } from '../CheckpointRow';
import type { BalanceCheckpoint } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

// CheckpointRow uses both the 'accounts' namespace (the "add a note" hint)
// and 'common' (the delete button). Preload both for both locales, pinned
// to French, so `useTranslation` never suspends and the existing
// French-literal assertions below keep matching real rendered text.
pinLocale('accounts');

const cp: BalanceCheckpoint = {
  id: 1, accountId: 1, checkpointDate: '2025-06-01',
  expectedAmount: '100.00', note: 'relevé BNP', createdAt: '2026-01-01T00:00:00Z',
};

describe('CheckpointRow', () => {
  it('commits the new amount on Enter', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /100/ }));
    const input = screen.getByDisplayValue('100.00');
    await user.clear(input);
    await user.type(input, '150.50{Enter}');
    expect(onSave).toHaveBeenCalledWith({ expectedAmount: '150.50' });
  });

  it('blur unchanged does NOT fire onSave', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /100/ }));
    screen.getByDisplayValue('100.00');
    await user.click(document.body); // blur without typing
    expect(onSave).not.toHaveBeenCalled();
  });

  it('trims a whitespace note to null on save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={onSave} onDelete={() => {}} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /relevé BNP/i }));
    const input = screen.getByDisplayValue('relevé BNP');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onSave).toHaveBeenCalledWith({ note: null });
  });

  it('fires onDelete when ✕ is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<CheckpointRow cp={cp} currency="EUR" onSave={() => {}} onDelete={onDelete} saving={false} deleting={false} />);
    await user.click(screen.getByRole('button', { name: /supprimer/i }));
    expect(onDelete).toHaveBeenCalled();
  });
});
