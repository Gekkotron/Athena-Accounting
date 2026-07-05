import { describe, it, expect } from 'vitest';
import {
  deriveAccountAnchor,
  deriveOtherAccountAnchors,
  extractStableAnchor,
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

  it('returns null when every page is selected AND no account-header-like line is present', () => {
    const pages = [
      page(0, [item(0, 'HEADER', 40, 50)]),
      page(1, [item(1, 'HEADER', 40, 50)]),
    ];
    expect(deriveAccountAnchor(pages, [0, 1])).toBeNull();
  });

  it('falls back to the MOST FREQUENT account-header line when every page is selected', () => {
    // Real-user layout: Compte Courant header repeats on pages 0,1,2 and
    // Livret A appears mid-page-2 with 1 occurrence. Intersection path
    // has no "other" to distinguish from, but frequency picks Compte
    // Courant (3 pages) over Livret A (1 page).
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT PRIVE EUR N° 00020389601 en euros (GD)', 40, 50),
        item(0, '15/01/2026 tx', 40, 200),
      ]),
      page(1, [
        item(1, 'COMPTE COURANT PRIVE EUR N° 00020389601 en euros (GD)', 40, 50),
        item(1, '20/01/2026 tx', 40, 200),
      ]),
      page(2, [
        item(2, 'COMPTE COURANT PRIVE EUR N° 00020389601 en euros (GD)', 40, 50),
        item(2, '25/01/2026 tx', 40, 200),
        item(2, 'LIVRET A SUP N° 00020389603', 40, 500), // mid-page transition
      ]),
    ];
    expect(deriveAccountAnchor(pages, [0, 1, 2]))
      .toBe('compte courant prive eur n° 00020389601 en euros (gd)');
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

describe('extractStableAnchor', () => {
  it('extracts the "n° <digits>" account-number substring', () => {
    expect(extractStableAnchor('C/C CONTRAT PERSONNEL GLOBAL N° 00020389601 EN EUROS (GD)'))
      .toBe('n° 00020389601');
    // Case + accent variants all reduce to lowercase.
    expect(extractStableAnchor('LIVRET A n° 98765')).toBe('n° 98765');
    expect(extractStableAnchor('LIVRET A N˚ 98765')).toBe('n˚ 98765');
  });

  it('returns null when no account-number pattern is present', () => {
    expect(extractStableAnchor('compte courant sans numero')).toBeNull();
    // Runs of fewer than 5 digits don't count — avoids false-positives on
    // amounts or short numbers in headers.
    expect(extractStableAnchor('page 1 sur 3 n° 42')).toBeNull();
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

  it('matches an anchor even when the words are on slightly-different baselines (line fragmentation)', () => {
    // pdfjs sometimes returns adjacent words with different yTop values
    // (baseline drift, italics, small caps). The lineifier groups within
    // a 2pt tolerance — here the gap is 4pt, so "livret a" and "sup" end
    // up in separate lines. Flat-text scanning still finds "livret a sup".
    const p = page(0, [
      item(0, 'LIVRET A', 40, 100),
      item(0, 'SUP', 100, 104), // 4pt below — different "line" for the tolerance
    ]);
    expect(pageContainsAnchor(p, 'livret a sup')).toBe(true);
  });

  it('falls back to the account-number substring when the anchor\'s marketing prefix changed', () => {
    // Sample statement stored the anchor as its full header line.
    const storedAnchor = 'C/C CONTRAT PERSONNEL GLOBAL N° 00020389601 EN EUROS (GD)';
    // Next month, the bank reworded the header but the account number is
    // stable. The exact stored anchor no longer appears, but "n°
    // 00020389601" does — the fallback kicks in.
    const p = page(0, [
      item(0, 'COMPTE COURANT PRIVE EUR N° 00020389601 en euros (GD)', 40, 50),
      item(0, '15/01/2026 tx', 40, 200),
    ]);
    expect(pageContainsAnchor(p, storedAnchor)).toBe(true);
  });

  it('fallback does NOT hit when the account number is different', () => {
    const p = page(0, [
      item(0, 'COMPTE COURANT PRIVE EUR N° 99999999999 en euros (GD)', 40, 50),
    ]);
    expect(pageContainsAnchor(p, 'C/C CONTRAT PERSONNEL GLOBAL N° 00020389601 EN EUROS (GD)')).toBe(false);
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

describe('deriveOtherAccountAnchors — expanded keyword whitelist', () => {
  it('recognizes "C/C" (Compte Courant abbreviation) as another account header', () => {
    const pages = [
      page(0, [
        item(0, 'LIVRET A n° 12345', 40, 50),
        item(0, '10/01/2026 intérêts', 40, 200),
        item(0, 'C/C CONTRAT PERSONNEL', 40, 500),
        item(0, '15/01/2026 tx', 40, 550),
      ]),
    ];
    expect(
      deriveOtherAccountAnchors(pages, [0], 'livret a n° 12345'),
    ).toEqual(['c/c contrat personnel']);
  });

  it('recognizes LDDS, PEA-PME, PEP as headers', () => {
    for (const line of ['LDDS n° 111', 'PEA-PME 22222', 'PEP n° 3333333']) {
      const pages = [
        page(0, [
          item(0, 'COMPTE COURANT n° 12345', 40, 50),
          item(0, '15/01/2026 tx', 40, 200),
          item(0, line, 40, 500),
        ]),
      ];
      const others = deriveOtherAccountAnchors(pages, [0], 'compte courant n° 12345');
      expect(others, `line=${line}`).toHaveLength(1);
      expect(others[0], `line=${line}`).toBe(line.toLowerCase());
    }
  });

  it('does NOT flag arbitrary transaction descriptions as headers', () => {
    // Neither "peage" nor "solde" should trigger the keyword filter.
    const pages = [
      page(0, [
        item(0, 'COMPTE COURANT n° 12345', 40, 50),
        item(0, 'PEAGE A6 auto', 40, 500), // 'pea' as substring, but the regex needs word boundary
        item(0, 'SOLDE INTERMÉDIAIRE 1234,56', 40, 550),
      ]),
    ];
    expect(deriveOtherAccountAnchors(pages, [0], 'compte courant n° 12345')).toEqual([]);
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

  it('flat-text scan finds an anchor whose words are split across baselines', () => {
    const p = page(0, [
      item(0, 'C/C CONTRAT PERSONNEL', 40, 50),
      item(0, '15/01/2026 tx', 40, 200),
      // Fragmented Livret A header: "LIVRET A SUP" split across two baselines.
      item(0, 'LIVRET A', 40, 500),
      item(0, 'SUP', 100, 504),
    ]);
    // The stored anchor is the joined string. Flat-text scan still finds it,
    // even though the items sit on different baselines.
    expect(firstOtherAnchorY(p, ['livret a sup'])).toBe(500);
  });
});
