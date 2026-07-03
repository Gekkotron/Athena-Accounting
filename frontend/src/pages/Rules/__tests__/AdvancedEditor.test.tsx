import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedEditor } from '../AdvancedEditor';
import type { Rule, Category } from '../../../api/types';

const originalRule: Rule = {
  id: 1,
  categoryId: 10,
  keyword: 'oldkw',
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
};
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];

describe('AdvancedEditor', () => {
  it('pre-fills from the rule prop', () => {
    render(<AdvancedEditor rule={originalRule} categories={cats} onClose={() => {}} onSave={() => {}} onDelete={() => {}} />);
    expect(screen.getByDisplayValue('oldkw')).toBeInTheDocument();
  });

  it('fires onSave with only the changed field on save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedEditor rule={originalRule} categories={cats} onClose={() => {}} onSave={onSave} onDelete={() => {}} />);
    const kwInput = screen.getByDisplayValue('oldkw');
    await user.clear(kwInput);
    await user.type(kwInput, 'newkw');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const call = onSave.mock.calls[0][0];
    expect(Object.keys(call)).toEqual(['keyword']);
    expect(call).toEqual({ keyword: 'newkw' });
  });

  it('fires onClose when the cancel button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedEditor rule={originalRule} categories={cats} onClose={onClose} onSave={() => {}} onDelete={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onClose on Escape', () => {
    const onClose = vi.fn();
    render(<AdvancedEditor rule={originalRule} categories={cats} onClose={onClose} onSave={() => {}} onDelete={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onDelete when the delete button is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<AdvancedEditor rule={originalRule} categories={cats} onClose={() => {}} onSave={() => {}} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
