import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Imports } from '../Imports';
import { withTips } from '../../../test/renderWithProviders';
import i18n from '../../../i18n';

// This route composes UploadForm, FileImportsList, PdfTemplateWizard, etc.,
// all of which use useTranslation('imports'); PdfTemplateWizard also renders
// the PdfTemplateBuilder wizard (namespace 'pdf-template') when a template
// upload needs one. Preload the namespaces for both locales so none of them
// suspend mid-render, then pin the active language to French so the
// existing French-literal assertions below keep matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['imports', 'pdf-template', 'common', 'tips']);
});

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: vi.fn(),
    apiUpload: vi.fn(),
  };
});
import { api, apiUpload } from '../../../api/client';
const apiMock = vi.mocked(api);
const uploadMock = vi.mocked(apiUpload);

function renderImports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withTips(<Imports />)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Field-by-label helper: the file input and account select have plain
// <label> siblings with no htmlFor/id association, so getByLabelText
// cannot find them.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
  uploadMock.mockReset();
});

const acc = (id: number, name: string) => ({
  id, name, type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
});

const fileImport = (id: number, overrides: Partial<any> = {}) => ({
  id, filename: `file-${id}.csv`, accountId: 1, format: 'csv',
  importedAt: '2026-06-15T00:00:00Z', totalLines: 10, insertedCount: 8,
  dedupSkipped: 2, statedBalance: null, statedBalanceDate: null,
  computedBalance: null, delta: null,
  ...overrides,
});

describe('Imports page (characterization)', () => {
  it('renders the upload form and the file-imports list', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/imports') return { imports: [fileImport(1)] };
      throw new Error(`unexpected: ${path}`);
    });

    renderImports();

    // Upload form present (plain label, no htmlFor — matched via text).
    expect(await screen.findByText(/^Fichier\(s\)/)).toBeInTheDocument();
    // File-imports list contains the mocked import.
    expect(await screen.findByText('file-1.csv')).toBeInTheDocument();
  });

  it('uploads a CSV file, walks the preview modal, and shows the "Dernier import" success banner', async () => {
    let uploaded = false;
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/imports') return { imports: uploaded ? [fileImport(99, { filename: 'new.csv' })] : [] };
      throw new Error(`unexpected: ${path}`);
    });
    // apiUpload now serves two endpoints: /api/imports/preview (dry-run) and
    // /api/imports (commit). Branch on the path so both flows are exercised.
    uploadMock.mockImplementation(async (path: string) => {
      if (path === '/api/imports/preview') {
        return {
          filename: 'new.csv', format: 'csv', accountId: 1, totalRows: 1,
          newRows: [{ date: '2026-06-15', amount: '-10.00', rawLabel: 'A', memo: null }],
          duplicateRows: [],
        };
      }
      uploaded = true;
      return { filename: 'new.csv', insertedCount: 5, dedupSkipped: 1, totalLines: 6 };
    });

    const user = userEvent.setup();
    renderImports();
    await screen.findByText(/^Fichier\(s\)/);

    const fileInput = fieldFor(/^Fichier\(s\)/) as HTMLInputElement;
    const file = new File(['date;label;amount\n2026-06-15;A;-10'], 'new.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    await user.selectOptions(fieldFor('Compte'), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    // Preview modal opens; click its "Importer" to commit.
    await screen.findByRole('dialog', { name: /Prévisualiser/ });
    const modalImporter = screen.getAllByRole('button', { name: /^(Importer|Import…)$/ })
      .find((b) => b.closest('[role="dialog"]'));
    await user.click(modalImporter!);

    // "Dernier import" banner shows the uploaded filename and inserted count.
    await screen.findByText('Dernier import');
    expect(await screen.findAllByText('new.csv')).toHaveLength(2);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows the PDF template wizard when the upload returns needs_template', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/imports') return { imports: [] };
      throw new Error(`unexpected: ${path}`);
    });

    // Imports.tsx calls submitPdf() (a raw-fetch helper), not apiUpload, for
    // .pdf files. Stub the global fetch it wraps instead of apiMock/uploadMock.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        kind: 'needs_template',
        draftId: 42,
        fingerprint: 'fp-xyz',
        pages: [{ pageIndex: 0, widthPt: 595, heightPt: 842, pngBase64: 'AAAA' }],
        textItems: [],
        suggestedZones: null,
        reason: 'low_confidence',
        sourceKind: 'pdf',
        ocrStatus: 'not_needed',
        ocrTotal: 0,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderImports();
    await screen.findByText(/^Fichier\(s\)/);

    const fileInput = fieldFor(/^Fichier\(s\)/) as HTMLInputElement;
    const file = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'statement.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor('Compte'), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    // PdfTemplateBuilder renders its step wizard, starting on the "header"
    // step. The step title text is split across sibling text nodes
    // ("Étape 1/5 — " + title), so match on the <p> element's own
    // textContent (the step-progress <li> repeats the same title, so an
    // ancestor-agnostic matcher hits both).
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && !!el.textContent?.includes("Sélectionnez l'en-tête"),
      ),
    ).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('shows the "Dernier import PDF" banner when the PDF auto-imports', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/imports') return { imports: [] };
      throw new Error(`unexpected: ${path}`);
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        kind: 'imported',
        result: { fileImportId: 50, insertedCount: 5, dedupSkipped: 0, totalLines: 8 },
        skippedRows: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderImports();
    await screen.findByText(/^Fichier\(s\)/);

    const fileInput = fieldFor(/^Fichier\(s\)/) as HTMLInputElement;
    const file = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], 'auto.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, file);
    await user.selectOptions(fieldFor('Compte'), '1');
    await user.click(screen.getByRole('button', { name: 'Importer' }));

    expect(await screen.findByText('Dernier import PDF')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('deletes a file-import after confirmation', async () => {
    let deleted = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/imports') return { imports: deleted ? [] : [fileImport(7)] };
      if (path === '/api/imports/7' && init?.method === 'DELETE') {
        deleted = true;
        return { deleted: { transactions: 8, fileImport: 1 } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderImports();
    await screen.findByText('file-7.csv');

    // Icon-only delete affordance, identified via aria-label.
    await user.click(screen.getByRole('button', { name: "Supprimer l'import" }));
    // ConfirmDialog appears with confirmLabel="Supprimer".
    await user.click(await screen.findByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(screen.queryByText('file-7.csv')).not.toBeInTheDocument());
  });
});
