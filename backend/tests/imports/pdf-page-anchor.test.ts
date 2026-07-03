import { describe, it, expect } from 'vitest';
import {
  deriveAccountAnchor,
  deriveOtherAccountAnchors,
  firstOtherAnchorY,
  pageContainsAnchor,
  pageLines,
} from '../../src/domain/imports/pdf/page-anchor.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(pageIndex: number, str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(pageIndex: number, items: PdfTextItem[]): PdfPageText {
  return { pageIndex, widthPt: 595, heightPt: 842, items };
}

describe('pageLines', () => {
  it('clusters items on the same yTop into a single line and lowercases the result', () => {
    const p = page(0, [
      item(0, 'COMPTE', 40, 100),
      item(0, 'COURANT', 100, 100),
      item(0, 'n° 12345', 160, 100),
      item(0, 'Autre ligne', 40, 200),
    ]);
    const lines = pageLines(p);
    expect(lines.has('compte courant n° 12345')).toBe(true);
    expect(lines.has('autre ligne')).toBe(true);
  });

  it('drops lines shorter than the minimum anchor length', () => {
    const p = page(0, [item(0, 'ab', 40, 100), item(0, 'longer line', 40, 200)]);
    const lines = pageLines(p);
    expect(lines.has('ab')).toBe(false);
    expect(lines.has('longer line')).toBe(true);
  });
});

describe('deriveAccountAnchor', () => {
  it('returns the header line that appears on every selected page and no other page', () => {
    // Two-account statement: pages 0..1 = Compte Courant, pages 2..3 = Livret A.
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT n° 12345', 40, 50),
        item(0, '15/01/2026', 40, 200), item(0, 'CB CARREFOUR', 120, 200), item(0, '-42,30', 480, 200),
      ]),
      page(1, [
        item(1, 'COMPTE COURANT n° 12345', 40, 50),
        item(1, '20/01/2026', 40, 200), item(1, 'VIR SALAIRE', 120, 200), item(1, '2500,00', 480, 200),
      ]),
      page(2, [
        item(2, 'LIVRET A n° 98765', 40, 50),
        item(2, '01/01/2026', 40, 200), item(2, 'INTÉRÊTS', 120, 200), item(2, '12,34', 480, 200),
      ]),
      page(3, [
        item(3, 'LIVRET A n° 98765', 40, 50),
        item(3, '15/01/2026', 40, 200), item(3, 'VERSEMENT', 120, 200), item(3, '100,00', 480, 200),
      ]),
    ];
    // User building the "Compte Courant" template checks pages 0 and 1.
    const anchor = deriveAccountAnchor(pages, [0, 1]);
    expect(anchor).toBe('compte courant n° 12345');
  });

  it('returns null when every page is selected (nothing to distinguish)', () => {
    const pages = [
      page(0, [item(0, 'HEADER', 40, 50)]),
      page(1, [item(1, 'HEADER', 40, 50)]),
    ];
    expect(deriveAccountAnchor(pages, [0, 1])).toBeNull();
  });

  it('returns null when no line uniquely identifies the selected set', () => {
    // All pages carry the same header — no way to tell them apart by content.
    const pages = [
      page(0, [item(0, 'GENERIC HEADER', 40, 50), item(0, 'unique to page 0 abcde', 40, 100)]),
      page(1, [item(1, 'GENERIC HEADER', 40, 50), item(1, 'unique to page 1 wxyz', 40, 100)]),
    ];
    // No line appears in both selected pages but not in unselected — every
    // shared line ("generic header") also lives in the "other" page.
    // Note: with only ONE selected page here, the intersection-of-shared-
    // lines rule reduces to "lines of that one selected page" — but the
    // unique-to-that-page line "unique to page 0 abcde" doesn't appear on
    // the other selected pages (there are none), so it should be a valid
    // candidate. Let's test the properly ambiguous case:
    const withTwoSelected = [
      page(0, [item(0, 'GENERIC HEADER', 40, 50), item(0, 'unique to A abcdef', 40, 100)]),
      page(1, [item(1, 'GENERIC HEADER', 40, 50), item(1, 'unique to B ghijkl', 40, 100)]),
      page(2, [item(2, 'GENERIC HEADER', 40, 50), item(2, 'unique to C mnopqr', 40, 100)]),
    ];
    // Select pages 0 and 1 — the only line they share is "generic header",
    // which also appears on the unselected page 2. Should return null.
    expect(deriveAccountAnchor(withTwoSelected, [0, 1])).toBeNull();
    // Silence the unused-variable lint in the pre-context case.
    void pages;
  });

  it('picks the LONGEST surviving anchor when multiple candidates qualify', () => {
    const pages = [
      page(0, [item(0, 'COMPTE COURANT n° 12345', 40, 50), item(0, 'ANCRE', 40, 80)]),
      page(1, [item(1, 'COMPTE COURANT n° 12345', 40, 50), item(1, 'ANCRE', 40, 80)]),
      page(2, [item(2, 'LIVRET A n° 98765', 40, 50)]),
    ];
    // Both "compte courant n° 12345" and "ancre" qualify; the longer one wins.
    expect(deriveAccountAnchor(pages, [0, 1])).toBe('compte courant n° 12345');
  });

  it('handles a single selected page as long as it has a line no other page carries', () => {
    const pages = [
      page(0, [item(0, 'COMPTE COURANT n° 12345', 40, 50)]),
      page(1, [item(1, 'LIVRET A n° 98765', 40, 50)]),
    ];
    expect(deriveAccountAnchor(pages, [0])).toBe('compte courant n° 12345');
  });

  it('returns null when the selected list is empty', () => {
    const pages = [page(0, [item(0, 'HEADER', 40, 50)])];
    expect(deriveAccountAnchor(pages, [])).toBeNull();
  });
});

describe('pageContainsAnchor', () => {
  it('matches on lineified page text', () => {
    const p = page(0, [item(0, 'COMPTE', 40, 50), item(0, 'COURANT', 100, 50)]);
    expect(pageContainsAnchor(p, 'COMPTE COURANT')).toBe(true);
    expect(pageContainsAnchor(p, 'compte courant')).toBe(true);
    expect(pageContainsAnchor(p, 'livret a')).toBe(false);
  });

  it('returns false for an empty anchor', () => {
    const p = page(0, [item(0, 'HEADER', 40, 50)]);
    expect(pageContainsAnchor(p, '')).toBe(false);
    expect(pageContainsAnchor(p, '   ')).toBe(false);
  });
});

describe('deriveOtherAccountAnchors', () => {
  it('collects header lines from every unchecked page, preferring account-keyword lines', () => {
    // Selected pages: 0 and 1 (Compte Courant). Unchecked pages: 2 (Livret A)
    // and 3 (LEP). Each unchecked page contributes its own signature.
    const pages = [
      page(0, [item(0, 'COMPTE COURANT n° 12345', 40, 50), item(0, '15/01/2026 CB', 40, 200)]),
      page(1, [item(1, 'COMPTE COURANT n° 12345', 40, 50), item(1, '16/01/2026 VIR', 40, 200)]),
      page(2, [item(2, 'LIVRET A n° 98765', 40, 50), item(2, '01/01/2026 intérêts', 40, 200)]),
      page(3, [item(3, 'LEP n° 55555', 40, 50), item(3, '02/01/2026 dépôt', 40, 200)]),
    ];
    const others = deriveOtherAccountAnchors(pages, [0, 1]);
    expect(others).toContain('livret a n° 98765');
    expect(others).toContain('lep n° 55555');
    // Sorted deterministically for stable persistence.
    expect(others).toEqual([...others].sort());
  });

  it('returns [] when there are no unchecked pages', () => {
    const pages = [page(0, [item(0, 'HEADER', 40, 50)])];
    expect(deriveOtherAccountAnchors(pages, [0])).toEqual([]);
  });

  it('returns [] when unchecked pages carry only lines already present on selected pages', () => {
    // Unchecked pages have no line that's unique to them — nothing to key on.
    const pages = [
      page(0, [item(0, 'GENERIC HEADER', 40, 50), item(0, 'daily row', 40, 100)]),
      page(1, [item(1, 'GENERIC HEADER', 40, 50)]),
    ];
    expect(deriveOtherAccountAnchors(pages, [0])).toEqual([]);
  });

  it('discovers a mid-page transition even when EVERY page is selected (no unchecked pages)', () => {
    // Livret A section fits entirely on the tail of page 1. The user
    // (rightly) checks every page — there are no unchecked pages for the
    // original derivation path to scan. Path B (below-anchor keyword
    // scan on the SELECTED pages) picks up the "livret a n° 98765" line.
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT n° 12345', 40, 50),
        item(0, '15/01/2026 tx', 40, 200),
      ]),
      page(1, [
        item(1, 'COMPTE COURANT n° 12345', 40, 50),
        item(1, '20/01/2026 tx', 40, 200),
        item(1, 'LIVRET A n° 98765', 40, 500),
        item(1, '01/01/2026 intérêts', 40, 550),
      ]),
    ];
    const others = deriveOtherAccountAnchors(pages, [0, 1], 'compte courant n° 12345');
    expect(others).toEqual(['livret a n° 98765']);
  });

  it('skips keyword lines that sit ABOVE the account anchor on the same page (cover-page filler)', () => {
    const pages = [
      page(0, [
        // A cover-page keyword header ABOVE our anchor. Should NOT be picked.
        item(0, 'COMPTE À TERME résumé', 40, 20),
        item(0, 'COMPTE COURANT n° 12345', 40, 100), // <-- our anchor
        item(0, '15/01/2026 tx', 40, 200),
      ]),
    ];
    expect(
      deriveOtherAccountAnchors(pages, [0], 'compte courant n° 12345'),
    ).toEqual([]);
  });

  it('skips keyword lines that sit below the anchor but ABOVE rowsStartY (page-header decoration)', () => {
    // "COMPTE Détails" is a decorative label between the anchor (top of the
    // account section) and the transaction table. It's below the anchor's Y
    // (so the below-anchor guard doesn't catch it) but above rowsStartY (so
    // treating it as a cutoff would shrink the row window to zero).
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT n° 12345', 40, 50),
        item(0, 'COMPTE Détails', 40, 100), // decoration between anchor and table
        item(0, '15/01/2026 tx', 40, 220), // first real row
      ]),
    ];
    expect(
      deriveOtherAccountAnchors(pages, [0], 'compte courant n° 12345', /*rowsStartY*/ 200),
    ).toEqual([]);
  });

  it('keeps a keyword header even when it ALSO appears on a selected page (mid-page transition)', () => {
    // The typical bug: page 2 carries our anchor at the top AND the start of
    // Livret A halfway down. Page 3 is a pure Livret A page. Because Livret
    // A's header line appears on page 2 too, the earlier filter dropped it
    // from candidates. Now the keyword-headers path ignores selectedLines,
    // so the marker survives.
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT n° 12345', 40, 50),
        item(0, '15/01/2026 tx', 40, 200),
      ]),
      page(1, [
        item(1, 'COMPTE COURANT n° 12345', 40, 50),
        item(1, '20/01/2026 tx', 40, 200),
        item(1, 'LIVRET A n° 98765', 40, 500), // <-- also here (mid-page)
        item(1, 'a first livret A row', 40, 550),
      ]),
      page(2, [
        item(2, 'LIVRET A n° 98765', 40, 50), // <-- header on unchecked page
        item(2, '10/01/2026 intérêts', 40, 200),
      ]),
    ];
    // User checks pages 0 and 1 (both Compte Courant, plus page 1's tail
    // that spills into Livret A). Page 2 unchecked.
    const others = deriveOtherAccountAnchors(pages, [0, 1]);
    expect(others).toEqual(['livret a n° 98765']);
  });

  it('falls back to the longest non-keyword line when no keyword header is present', () => {
    const pages = [
      page(0, [item(0, 'ACC OWN HEADER', 40, 50)]),
      page(1, [
        item(1, 'STRUCTURED IDENTIFIER 987654321', 40, 50), // > 10 chars, no keyword
        item(1, 'x', 40, 200), // too short — dropped
      ]),
    ];
    const others = deriveOtherAccountAnchors(pages, [0]);
    expect(others).toEqual(['structured identifier 987654321']);
  });
});

describe('firstOtherAnchorY', () => {
  it('returns the yTop of the earliest matching anchor on the page', () => {
    const p = page(0, [
      item(0, 'COMPTE COURANT n° 12345', 40, 50), // our anchor — up top
      item(0, '15/01/2026 tx', 40, 200),
      item(0, 'LIVRET A n° 98765', 40, 500), // other-account starts mid-page
    ]);
    expect(firstOtherAnchorY(p, ['livret a n° 98765'])).toBe(500);
  });

  it('returns null when no other-anchor line is present on the page', () => {
    const p = page(0, [item(0, 'COMPTE COURANT n° 12345', 40, 50)]);
    expect(firstOtherAnchorY(p, ['livret a n° 98765'])).toBeNull();
  });

  it('returns null on empty other-anchor lists', () => {
    const p = page(0, [item(0, 'HEADER', 40, 50)]);
    expect(firstOtherAnchorY(p, [])).toBeNull();
  });

  it('picks the smallest yTop when multiple other-anchors are on the same page', () => {
    const p = page(0, [
      item(0, 'COMPTE COURANT n° 12345', 40, 50),
      item(0, 'LEP n° 55555', 40, 700), // farther down
      item(0, 'LIVRET A n° 98765', 40, 400), // earlier — should win
    ]);
    expect(firstOtherAnchorY(p, ['livret a n° 98765', 'lep n° 55555'])).toBe(400);
  });
});
