import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadForm } from '../UploadForm';
import type { Account } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn(), apiUpload: vi.fn() };
});
import { apiUpload } from '../../../api/client';
const uploadMock = vi.mocked(apiUpload);

vi.mock('../../../api/pdf-templates', async () => {
  const actual = await vi.importActual<typeof import('../../../api/pdf-templates')>('../../../api/pdf-templates');
  return { ...actual, submitPdf: vi.fn(), submitPhoto: vi.fn() };
});
import { submitPdf, submitPhoto } from '../../../api/pdf-templates';
const submitPdfMock = vi.mocked(submitPdf);
const submitPhotoMock = vi.mocked(submitPhoto);

vi.mock('../../../api/imports', () => ({ previewImport: vi.fn() }));
import { previewImport } from '../../../api/imports';
const previewMock = vi.mocked(previewImport);

const accs: Account[] = [
  { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
    openingBalance: '0', openingDate: '2025-01-01' },
];

function renderForm(overrides: Partial<any> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    accounts: accs,
    onPdfNeedsTemplate: vi.fn(),
    onPdfImported: vi.fn(),
    onOfxCsvSuccess: vi.fn(),
    onFileSelected: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <QueryClientProvider client={client}>
        <UploadForm {...props} />
      </QueryClientProvider>,
    ),
    props,
  };
}

// The file input and account select render a plain <label> sibling with no
// htmlFor/id association, so getByLabelText cannot find them (same
// limitation documented in Imports.test.tsx / AccountForm.test.tsx).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  uploadMock.mockReset();
  submitPdfMock.mockReset();
  submitPhotoMock.mockReset();
  previewMock.mockReset();
});

describe('UploadForm', () => {
  it('renders file input + account select + submit button', () => {
    renderForm();
    expect(fieldFor(/^Fichier/)).toBeInTheDocument();
    expect(fieldFor(/^Compte$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer' })).toBeInTheDocument();
  });

  it('CSV single-file submit opens the preview modal, then Importer inside the modal fires apiUpload', async () => {
    previewMock.mockResolvedValue({
      filename: 'new.csv', format: 'csv', accountId: 1, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-10.00', rawLabel: 'A', memo: null }],
      duplicateRows: [],
    });
    uploadMock.mockResolvedValue({ filename: 'new.csv', insertedCount: 5, dedupSkipped: 1, totalLines: 6 });
    const user = userEvent.setup();
    const { props } = renderForm();

    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['date;label;amount\n2026-06-15;A;-10'], 'new.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    // Preview endpoint fires first; real upload has NOT happened yet.
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(uploadMock).not.toHaveBeenCalled();

    // Click the modal's Importer (second one on screen).
    const modalImporter = screen.getAllByRole('button', { name: /^(Importer|Import…)$/ })
      .find((b) => b.closest('[role="dialog"]'));
    await user.click(modalImporter!);

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith('/api/imports', file, { query: { accountId: 1 } }));
    expect(props.onOfxCsvSuccess).toHaveBeenCalledWith({
      filename: 'new.csv',
      inserted: 5,
      skipped: 1,
      total: 6,
    });
  });

  it('clicking Annuler in the preview modal closes it and does not call apiUpload', async () => {
    previewMock.mockResolvedValue({
      filename: 'p.csv', format: 'csv', accountId: 1, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'p.csv', { type: 'text/csv' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await screen.findByRole('dialog', { name: /Prévisualiser/ });
    const modalCancel = screen.getAllByRole('button', { name: 'Annuler' })
      .find((b) => b.closest('[role="dialog"]'));
    await user.click(modalCancel!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Prévisualiser/ })).not.toBeInTheDocument());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('PDF single-file submit skips the preview modal (goes straight to submitPdf)', async () => {
    submitPdfMock.mockResolvedValue({
      kind: 'imported',
      result: { fileImportId: 1, insertedCount: 1, dedupSkipped: 0, totalLines: 1 },
      skippedRows: [],
    } as any);
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }));
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(submitPdfMock).toHaveBeenCalledTimes(1));
    expect(previewMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Prévisualiser/ })).not.toBeInTheDocument();
  });

  it('multi-file batch skips the preview modal (imports directly)', async () => {
    uploadMock.mockResolvedValue({ filename: 'a.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, [
      new File(['x'], 'a.csv', { type: 'text/csv' }),
      new File(['x'], 'b.csv', { type: 'text/csv' }),
    ]);
    await user.click(screen.getByRole('button', { name: /Importer 2 fichiers/ }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('PDF needs_template response fires onPdfNeedsTemplate', async () => {
    const response = {
      kind: 'needs_template' as const,
      draftId: 42,
      fingerprint: 'x',
      pages: [],
      textItems: [],
      suggestedZones: null,
      reason: 'low_confidence' as const,
      sourceKind: 'pdf' as const,
      ocrStatus: 'not_needed' as const,
      ocrTotal: 0,
    };
    submitPdfMock.mockResolvedValue(response);
    const user = userEvent.setup();
    const { props } = renderForm();

    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    await waitFor(() => expect(submitPdfMock).toHaveBeenCalledWith(file, 1));
    expect(props.onPdfNeedsTemplate).toHaveBeenCalledWith(response);
  });

  it('submit is disabled when no file is picked', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Importer' })).toBeDisabled();
  });

  it('rejects a PDF submit when no account is selected', async () => {
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    // Leave account empty (the "—" placeholder).
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    // Neither submitPdf nor apiUpload should fire.
    expect(submitPdfMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    // Error banner surfaces the account-required message.
    expect(await screen.findByText(/veuillez sélectionner un compte/i)).toBeInTheDocument();
    // Callbacks that indicate success mustn't have fired.
    expect(props.onPdfNeedsTemplate).not.toHaveBeenCalled();
    expect(props.onPdfImported).not.toHaveBeenCalled();
  });

  it('PDF imported response fires onPdfImported', async () => {
    const response = {
      kind: 'imported' as const,
      result: { fileImportId: 7, insertedCount: 4, dedupSkipped: 1, totalLines: 5 },
      skippedRows: [],
    };
    submitPdfMock.mockResolvedValue(response);
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['%PDF'], 'b.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    await waitFor(() => expect(props.onPdfImported).toHaveBeenCalledWith(response));
  });

  it('OFX/CSV error from preview surfaces the ApiError message in the banner', async () => {
    const { ApiError } = await import('../../../api/client');
    previewMock.mockRejectedValue(new ApiError('doublon détecté', 409, null));
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    expect(await screen.findByText(/doublon détecté/i)).toBeInTheDocument();
    expect(props.onOfxCsvSuccess).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('picking a file calls onFileSelected so the parent can clear stale banners', async () => {
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    await user.upload(fileInput, new File(['x'], 'x.csv', { type: 'text/csv' }));
    expect(props.onFileSelected).toHaveBeenCalled();
  });

  it('multi-file batch: label reads "Importer N fichiers" and drives sequential apiUpload calls', async () => {
    uploadMock.mockResolvedValue({ filename: 'x', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const f1 = new File(['a'], 'a.csv', { type: 'text/csv' });
    const f2 = new File(['b'], 'b.csv', { type: 'text/csv' });
    await user.upload(fileInput, [f1, f2]);
    // Label now advertises the count.
    expect(await screen.findByRole('button', { name: /importer 2 fichiers/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /importer 2 fichiers/i }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    // Batch summary card shows up with a "Fermer" button — its presence
    // proves the batch.done state rendered.
    expect(await screen.findByRole('button', { name: /^fermer$/i })).toBeInTheDocument();
  });

  it('drops files with unsupported extensions from the batch (e.g. .DS_Store)', async () => {
    const user = userEvent.setup();
    renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const junk = new File([''], '.DS_Store', { type: 'application/octet-stream' });
    const good = new File(['x'], 'x.csv', { type: 'text/csv' });
    await user.upload(fileInput, [junk, good]);
    // Only 1 file survives → single-file mode → submit label stays "Importer".
    expect(screen.getByRole('button', { name: 'Importer' })).toBeInTheDocument();
  });

  it('routes a JPEG upload to /api/imports/photo', async () => {
    const response = {
      kind: 'needs_template' as const,
      draftId: 5,
      fingerprint: '',
      pages: [],
      textItems: [],
      suggestedZones: null,
      reason: 'no_text_layer' as const,
      sourceKind: 'photo' as const,
      ocrStatus: 'pending' as const,
      ocrTotal: 1,
    };
    submitPhotoMock.mockResolvedValue(response);
    const user = userEvent.setup();
    const { props } = renderForm();

    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'st.jpg', { type: 'image/jpeg' });
    const photoInput = screen.getByLabelText(/photo/i) as HTMLInputElement;
    await user.upload(photoInput, jpeg);
    const accountSelect = screen.getByLabelText(/^compte$/i);
    await user.selectOptions(accountSelect, '1');
    await user.click(screen.getByRole('button', { name: /importer/i }));

    await waitFor(() => expect(submitPhotoMock).toHaveBeenCalledWith(jpeg, 1));
    expect(props.onPdfNeedsTemplate).toHaveBeenCalledWith(response);
    // apiUpload / submitPdf must not fire on the photo path.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(submitPdfMock).not.toHaveBeenCalled();
  });
});
