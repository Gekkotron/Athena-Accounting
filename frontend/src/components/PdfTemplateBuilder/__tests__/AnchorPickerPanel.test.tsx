import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnchorPickerPanel } from '../AnchorPickerPanel';
import type { PdfImportNeedsTemplate, PdfTextItem } from '../../../api/pdf-templates';
import i18n from '../../../i18n';

// AnchorPickerPanel renders French strings by default (the app's current UI
// language). Preload the 'pdf-template' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['pdf-template', 'common']);
});

function item(pageIndex: number, str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function makeNeeds(items: PdfTextItem[]): PdfImportNeedsTemplate {
  const pageIndices = Array.from(new Set(items.map((i) => i.pageIndex))).sort();
  return {
    kind: 'needs_template',
    draftId: 1,
    fingerprint: 'x',
    pages: pageIndices.map((i) => ({
      pageIndex: i, pngBase64: 'AAAA', widthPt: 595, heightPt: 842,
    })),
    textItems: items,
    suggestedZones: null,
    reason: 'low_confidence',
    sourceKind: 'pdf',
    ocrStatus: 'not_needed',
    ocrTotal: 0,
  };
}

describe('AnchorPickerPanel', () => {
  it('shows a fallback hint when no candidate headers exist', () => {
    const nt = makeNeeds([item(0, '15/01/2026 tx', 40, 200)]);
    render(
      <AnchorPickerPanel
        needsTemplate={nt}
        pageAnchor={null} otherAnchors={[]}
        onPageAnchorChange={() => {}} onOtherAnchorsChange={() => {}}
      />,
    );
    expect(screen.getByText(/aucun candidat/i)).toBeInTheDocument();
  });

  it('lists every account-header-like line as a picker row', () => {
    const nt = makeNeeds([
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, '15/01/2026 tx', 40, 200), // not a header
      item(0, 'LIVRET A n° 98765', 40, 500),
      item(0, 'PEA-PME 22222', 40, 700),
    ]);
    render(
      <AnchorPickerPanel
        needsTemplate={nt}
        pageAnchor={null} otherAnchors={[]}
        onPageAnchorChange={() => {}} onOtherAnchorsChange={() => {}}
      />,
    );
    expect(screen.getByText(/compte courant n° 12345/i)).toBeInTheDocument();
    expect(screen.getByText(/livret a n° 98765/i)).toBeInTheDocument();
    expect(screen.getByText(/pea-pme 22222/i)).toBeInTheDocument();
    // Non-header transaction line should NOT appear.
    expect(screen.queryByText(/15\/01\/2026/)).toBeNull();
  });

  it('clicking "Le mien" auto-marks every OTHER candidate as an "Autre compte"', async () => {
    const nt = makeNeeds([
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, 'LIVRET A n° 98765', 40, 500),
      item(0, 'LEP n° 55555', 40, 700),
    ]);
    const onPick = vi.fn();
    let others: string[] = [];
    const setOthers = (updater: (prev: string[]) => string[]) => { others = updater(others); };
    const user = userEvent.setup();
    render(
      <AnchorPickerPanel
        needsTemplate={nt}
        pageAnchor={null} otherAnchors={others}
        onPageAnchorChange={onPick} onOtherAnchorsChange={setOthers}
      />,
    );
    const radios = screen.getAllByRole('radio', { name: /le mien/i });
    await user.click(radios[0]!); // Compte Courant
    expect(onPick).toHaveBeenLastCalledWith('compte courant n° 12345');
    // Every other candidate is now flagged as "Autre compte" — safe default
    // for mid-page transitions.
    expect(others).toEqual(['livret a n° 98765', 'lep n° 55555']);
  });

  it('clicking "Autre compte" appends to the otherAnchors array', async () => {
    const nt = makeNeeds([
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, 'LIVRET A n° 98765', 40, 500),
    ]);
    let others: string[] = [];
    const setOthers = (updater: (prev: string[]) => string[]) => { others = updater(others); };
    const user = userEvent.setup();
    render(
      <AnchorPickerPanel
        needsTemplate={nt}
        pageAnchor="compte courant n° 12345" otherAnchors={others}
        onPageAnchorChange={() => {}} onOtherAnchorsChange={setOthers}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox', { name: /autre compte/i });
    // Livret A is the second candidate; its checkbox is enabled (not the mine one).
    await user.click(checkboxes[1]!);
    expect(others).toEqual(['livret a n° 98765']);
  });

  it('picking a line as "mine" excludes it from the auto-populated others', async () => {
    // Two candidates. Picking Livret A as "mine" should reset otherAnchors
    // to just [Compte Courant] — Livret A itself must NOT be listed as an
    // "other" (a line can't be both).
    const nt = makeNeeds([
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, 'LIVRET A n° 98765', 40, 500),
    ]);
    let others: string[] = ['livret a n° 98765'];
    const setOthers = (updater: (prev: string[]) => string[]) => { others = updater(others); };
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <AnchorPickerPanel
        needsTemplate={nt}
        pageAnchor={null} otherAnchors={others}
        onPageAnchorChange={onPick} onOtherAnchorsChange={setOthers}
      />,
    );
    const radios = screen.getAllByRole('radio', { name: /le mien/i });
    await user.click(radios[1]!); // Livret A — was in "others"
    expect(onPick).toHaveBeenLastCalledWith('livret a n° 98765');
    expect(others).toEqual(['compte courant n° 12345']);
  });
});
