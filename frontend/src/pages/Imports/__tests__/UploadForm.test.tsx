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
});
