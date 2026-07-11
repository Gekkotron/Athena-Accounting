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
  return { ...actual, submitPdf: vi.fn() };
});
import { submitPdf } from '../../../api/pdf-templates';
const submitPdfMock = vi.mocked(submitPdf);

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
});

describe('UploadForm', () => {
  it('renders file input + account select + submit button', () => {
    renderForm();
    expect(fieldFor(/^Fichier/)).toBeInTheDocument();
    expect(fieldFor(/^Compte$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer' })).toBeInTheDocument();
  });

  it('CSV submit fires apiUpload and onOfxCsvSuccess with the transformed shape', async () => {
    uploadMock.mockResolvedValue({ filename: 'new.csv', insertedCount: 5, dedupSkipped: 1, totalLines: 6 });
    const user = userEvent.setup();
    const { props } = renderForm();

    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['date;label;amount\n2026-06-15;A;-10'], 'new.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock).toHaveBeenCalledWith('/api/imports', file, { query: { accountId: 1 } });
    expect(props.onOfxCsvSuccess).toHaveBeenCalledWith({
      filename: 'new.csv',
      inserted: 5,
      skipped: 1,
      total: 6,
    });
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

  it('OFX/CSV error surfaces the ApiError message in the banner', async () => {
    const { ApiError } = await import('../../../api/client');
    uploadMock.mockRejectedValue(new ApiError('doublon détecté', 409, null));
    const user = userEvent.setup();
    const { props } = renderForm();
    const fileInput = fieldFor(/^Fichier/) as HTMLInputElement;
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor(/^Compte$/), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    expect(await screen.findByText(/doublon détecté/i)).toBeInTheDocument();
    expect(props.onOfxCsvSuccess).not.toHaveBeenCalled();
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
});
