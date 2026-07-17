import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractedTextPanel } from '../ExtractedTextPanel';
import type { PdfImportNeedsTemplate, PdfTextItem } from '../../../api/pdf-templates';
import { pinLocale } from '../../../test/i18n';

// ExtractedTextPanel renders French strings by default (the app's current UI
// language). Preload the 'pdf-template' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
pinLocale('pdf-template');

function item(pageIndex: number, str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function needsTemplate(pages: number, items: PdfTextItem[]): PdfImportNeedsTemplate {
  return {
    kind: 'needs_template',
    draftId: 1,
    fingerprint: 'x',
    pages: Array.from({ length: pages }, (_, i) => ({
      pageIndex: i,
      pngBase64: 'AAAA',
      widthPt: 595,
      heightPt: 842,
    })),
    textItems: items,
    suggestedZones: null,
    reason: 'low_confidence',
    sourceKind: 'pdf',
    ocrStatus: 'not_needed',
    ocrTotal: 0,
  };
}

describe('ExtractedTextPanel', () => {
  it('renders each page\'s lines behind a collapsible summary', async () => {
    const nt = needsTemplate(1, [
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, '15/01/2026', 40, 200),
      item(0, 'CB CARREFOUR', 120, 200),
      item(0, '-42,30', 480, 200),
    ]);
    const user = userEvent.setup();
    const { container } = render(<ExtractedTextPanel needsTemplate={nt} />);
    // Collapsed by default — <details> has no `open` attribute yet. jsdom
    // still renders the children in the DOM, so we probe the attribute
    // rather than a query for the hidden text.
    const detailsEl = container.querySelector('details');
    expect(detailsEl?.hasAttribute('open')).toBe(false);
    await user.click(screen.getByText(/voir le texte extrait/i));
    expect(detailsEl?.hasAttribute('open')).toBe(true);
    // Lines from the page are rendered, joined and lowercased in the DOM.
    expect(await screen.findByText(/compte courant/i)).toBeInTheDocument();
    expect(screen.getByText(/15\/01\/2026 CB CARREFOUR -42,30/i)).toBeInTheDocument();
    // Page header label shows the page number and line count.
    expect(screen.getByText(/page 1.*2 ligne/i)).toBeInTheDocument();
  });

  it('highlights lines that look like account headers with the sage-300 class', async () => {
    const nt = needsTemplate(1, [
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, 'random transaction line', 40, 200),
    ]);
    const user = userEvent.setup();
    const { container } = render(<ExtractedTextPanel needsTemplate={nt} />);
    await user.click(screen.getByText(/voir le texte extrait/i));
    const headerLi = container.querySelector('li.text-sage-300');
    const regularLi = container.querySelector('li.text-ink-300');
    expect(headerLi?.textContent).toMatch(/compte courant n° 12345/i);
    expect(regularLi?.textContent).toMatch(/random transaction line/i);
  });
});
