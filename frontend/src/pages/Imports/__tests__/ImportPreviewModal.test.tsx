import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewModal } from '../ImportPreviewModal';
import type { ImportPreview } from '../../../api/imports';
import i18n from '../../../i18n';

// ImportPreviewModal renders French strings by default (the app's current UI
// language). Preload the 'imports'/'common' namespaces for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['imports', 'common']);
});

const preview: ImportPreview = {
  filename: 'juin.csv',
  format: 'csv',
  accountId: 2,
  totalRows: 3,
  newRows: [
    { date: '2026-06-15', amount: '-3.50', rawLabel: 'Café', memo: null },
    { date: '2026-06-16', amount: '2000.00', rawLabel: 'Salaire', memo: null },
  ],
  duplicateRows: [
    { date: '2026-06-14', amount: '-10.00', rawLabel: 'Doublon', memo: null },
  ],
};

describe('ImportPreviewModal', () => {
  it('renders filename, counts summary, and every parsed row', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/juin\.csv/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*nouvelles/)).toBeInTheDocument();
    expect(screen.getByText(/1\s*dédupliquée/)).toBeInTheDocument();
    expect(screen.getByText(/sur\s*3/)).toBeInTheDocument();
    expect(screen.getByText('Café')).toBeInTheDocument();
    expect(screen.getByText('Salaire')).toBeInTheDocument();
    // "Doublon" appears twice: once as the row's label, once as the status tag.
    expect(screen.getAllByText('Doublon').length).toBeGreaterThanOrEqual(1);
  });

  it('tags new rows as "Nouveau" and duplicate rows as "Doublon"', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} />);
    const nouveaux = screen.getAllByText('Nouveau');
    const doublons = screen.getAllByText('Doublon');
    expect(nouveaux).toHaveLength(2);
    expect(doublons.length).toBeGreaterThanOrEqual(2);
  });

  it('fires onConfirm when Importer is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when Annuler is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    render(<ImportPreviewModal preview={preview} onConfirm={() => {}} onCancel={() => {}} pending />);
    expect(screen.getByRole('button', { name: /Import…|Importer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
  });

  it('collapses rows past 100 behind a "voir tout" toggle', async () => {
    const many: ImportPreview = {
      ...preview,
      totalRows: 150,
      newRows: Array.from({ length: 150 }, (_, i) => ({
        date: '2026-06-15', amount: '-1.00', rawLabel: `Row-${i}`, memo: null,
      })),
      duplicateRows: [],
    };
    const user = userEvent.setup();
    render(<ImportPreviewModal preview={many} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Row-0')).toBeInTheDocument();
    expect(screen.getByText('Row-99')).toBeInTheDocument();
    expect(screen.queryByText('Row-100')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /voir tout/ }));
    expect(screen.getByText('Row-149')).toBeInTheDocument();
  });
});
