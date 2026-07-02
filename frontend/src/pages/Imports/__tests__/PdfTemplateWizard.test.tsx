import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdfTemplateWizard } from '../PdfTemplateWizard';

describe('PdfTemplateWizard', () => {
  it('renders PdfTemplateBuilder when needsTpl is set', () => {
    render(
      <PdfTemplateWizard
        needsTpl={{
          kind: 'needs_template',
          draftId: 42,
          fingerprint: 'x',
          pages: [{ pageIndex: 0, widthPt: 595, heightPt: 842, pngBase64: 'AAAA' }],
          textItems: [],
          suggestedZones: null,
          reason: 'low_confidence',
        }}
        lastImported={null}
        accountId={1}
        onFinalize={() => {}}
        onCancel={() => {}}
      />,
    );
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
    render(
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
    );
    expect(screen.getByText('Dernier import PDF')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing when needsTpl and lastImported are both null', () => {
    const { container } = render(
      <PdfTemplateWizard
        needsTpl={null} lastImported={null}
        accountId={1} onFinalize={() => {}} onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
