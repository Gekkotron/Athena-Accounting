import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from '../Chip';
import type { Rule } from '../../../api/types';
import i18n from '../../../i18n';

// Chip uses both the 'rules' namespace (tooltip) and 'common' (Modifier/
// Supprimer button labels). Preload both for both locales, pinned to
// French, so `useTranslation` never suspends and the existing
// French-literal assertions below keep matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['rules', 'common']);
});

const rule: Rule = {
  id: 1,
  categoryId: 10,
  keyword: 'carrefour',
  signConstraint: 'any',
  matchMode: 'word',
  priority: 0,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('Chip', () => {
  it('renders the rule keyword', () => {
    render(<Chip rule={rule} onToggle={() => {}} onAdvanced={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('carrefour')).toBeInTheDocument();
  });

  it('fires onToggle when the keyword is clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<Chip rule={rule} onToggle={onToggle} onAdvanced={() => {}} onDelete={() => {}} />);
    await user.click(screen.getByText('carrefour'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('fires onAdvanced and onDelete from their respective buttons', async () => {
    const onAdvanced = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<Chip rule={rule} onToggle={() => {}} onAdvanced={onAdvanced} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(onAdvanced).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
