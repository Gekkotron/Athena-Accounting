import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdfTemplateBuilder } from '../index';
import type { PdfImportNeedsTemplate } from '../../../api/pdf-templates';
import { pinLocale } from '../../../test/i18n';

// PdfTemplateBuilder renders French strings by default (the app's current UI
// language). Preload the 'pdf-template' namespace (plus 'imports', which
// backend-error translations are keyed under — see api/errorMessage.ts) for
// both locales so `useTranslation` never suspends mid-render, then pin the
// active language to French so the existing French-literal assertions below
// keep matching real rendered text.
pinLocale('pdf-template', 'imports');

// Same rationale as PdfTemplateBuilder.preview.test.tsx: a static vi.mock so
// it's hoisted above the (also static) import of PdfTemplateBuilder above.
vi.mock('../ZoneCanvas', () => ({
  ZoneCanvas: (props: any) => (
    <button
      type="button"
      data-testid={`paint-${props.paintLabel ?? 'zone'}`}
      onClick={() => props.onChange({ x: 10, y: 10, w: 100, h: 20 })}
    >
      paint {props.paintLabel ?? 'zone'}
    </button>
  ),
}));

vi.mock('../../../api/pdf-templates', async () => {
  const actual = await vi.importActual<typeof import('../../../api/pdf-templates')>('../../../api/pdf-templates');
  return { ...actual, getOcrStatus: vi.fn(), getDraft: vi.fn() };
});
import { getOcrStatus, getDraft } from '../../../api/pdf-templates';
const getOcrStatusMock = vi.mocked(getOcrStatus);
const getDraftMock = vi.mocked(getDraft);

const draftId = 42;

const basePages = [{ pageIndex: 0, pngBase64: 'iVBORw0KGgo=', widthPt: 595, heightPt: 842 }];

function withProviders(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PdfTemplateBuilder — OCR wiring', () => {
  beforeEach(() => {
    getOcrStatusMock.mockReset();
    getDraftMock.mockReset();
  });
  afterEach(() => cleanup());

  it('shows the OcrProgress step when the draft is still recognizing text', () => {
    const needsTemplate: PdfImportNeedsTemplate = {
      kind: 'needs_template',
      draftId,
      fingerprint: 'test-fp',
      pages: basePages,
      textItems: [],
      suggestedZones: null,
      reason: 'low_confidence',
      sourceKind: 'photo',
      ocrStatus: 'pending',
      ocrTotal: 3,
    };
    getOcrStatusMock.mockResolvedValue({ status: 'pending', progress: 1, total: 3 });

    render(withProviders(
      <PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />,
    ));

    expect(screen.getByText(/reconnaissance/i)).toBeInTheDocument();
    // The zone-painting wizard (step indicator, header-step prompt) must not
    // render yet — the user only sees the progress screen.
    expect(screen.queryByText(/Sélectionnez l'en-tête/i)).not.toBeInTheDocument();
  });

  it('renders the zone-painting steps once OCR status flips to ready', async () => {
    const needsTemplate: PdfImportNeedsTemplate = {
      kind: 'needs_template',
      draftId,
      fingerprint: 'test-fp',
      pages: basePages,
      textItems: [],
      suggestedZones: null,
      reason: 'no_text_layer',
      sourceKind: 'pdf',
      ocrStatus: 'pending',
      ocrTotal: 1,
    };
    getOcrStatusMock.mockResolvedValue({ status: 'ready', progress: 1, total: 1, meanConfidence: 0.9 });
    getDraftMock.mockResolvedValue({ textItems: [], ocrStatus: 'ready' as any });

    render(withProviders(
      <PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />,
    ));

    await screen.findByText((_, el) => el?.tagName === 'P' && !!el.textContent?.includes("Sélectionnez l'en-tête"));
    expect(getDraftMock).toHaveBeenCalledWith(draftId);
  });

  it('never renders the old "OCR not available" banner', () => {
    const needsTemplate: PdfImportNeedsTemplate = {
      kind: 'needs_template',
      draftId,
      fingerprint: 'test-fp',
      pages: basePages,
      textItems: [],
      suggestedZones: null,
      reason: 'low_confidence',
      sourceKind: 'pdf',
      ocrStatus: 'not_needed',
      ocrTotal: 0,
    };

    render(withProviders(
      <PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />,
    ));

    expect(screen.queryByText(/l'OCR n'est pas encore disponible/i)).not.toBeInTheDocument();
  });
});
