import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdfTemplateWizard } from '../PdfTemplateWizard';
import i18n from '../../../i18n';

// PdfTemplateWizard's ImportSummary sub-component renders French strings by
// default (the app's current UI language), and it renders the
// PdfTemplateBuilder wizard (namespace 'pdf-template') when needsTpl is set.
// Preload the namespaces they consume for both locales so `useTranslation`
// never suspends mid-render, then pin the active language to French so the
// existing French-literal assertions below keep matching real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['imports', 'pdf-template', 'common']);
});

// The lastImported banner now fetches transactions by sourceFileId to
// display the "Transactions importées" list. Stub the api client so the
// hook can render without a real backend.
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn(async () => ({ transactions: [], pagination: { total: 0, limit: 500, offset: 0 } })) };
});

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe('PdfTemplateWizard', () => {
  it('renders PdfTemplateBuilder when needsTpl is set', () => {
    render(withClient(
      <PdfTemplateWizard
        needsTpl={{
          kind: 'needs_template',
          draftId: 42,
          fingerprint: 'x',
          pages: [{ pageIndex: 0, widthPt: 595, heightPt: 842, pngBase64: 'AAAA' }],
          textItems: [],
          suggestedZones: null,
          reason: 'low_confidence',
          sourceKind: 'pdf',
          ocrStatus: 'not_needed',
          ocrTotal: 0,
        }}
        lastImported={null}
        accountId={1}
        onFinalize={() => {}}
        onCancel={() => {}}
      />,
    ));
    // PdfTemplateBuilder starts on the "header" step; its step title is
    // split across sibling text nodes ("Étape 1/5 — " + title), so match on
    // the element's own textContent rather than an exact string.
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && !!el.textContent?.includes("Sélectionnez l'en-tête"),
      ),
    ).toBeInTheDocument();
  });

  it('renders lastImported banner when lastImported is set', () => {
    render(withClient(
      <PdfTemplateWizard
        needsTpl={null}
        lastImported={{
          kind: 'imported',
          result: { fileImportId: 50, insertedCount: 3, dedupSkipped: 0, totalLines: 8 },
          skippedRows: [],
        }}
        accountId={1}
        onFinalize={() => {}}
        onCancel={() => {}}
      />,
    ));
    expect(screen.getByText('Dernier import PDF')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Transactions list section header is present even before data loads.
    expect(screen.getByText(/Transactions importées/i)).toBeInTheDocument();
  });

  it('renders nothing when needsTpl and lastImported are both null', () => {
    const { container } = render(withClient(
      <PdfTemplateWizard
        needsTpl={null} lastImported={null}
        accountId={1} onFinalize={() => {}} onCancel={() => {}}
      />,
    ));
    expect(container.firstChild).toBeNull();
  });
});
