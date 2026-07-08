import { describe, it, expect } from 'vitest';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import type { TemplateZones } from '../../src/domain/imports/pdf/zones.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

const zones: TemplateZones = {
  headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
  tableZone: { page: 0, x: 30, y: 200, w: 540, h: 600 },
  tableRepeatsPerPage: false,
  columns: [
    { xStart: 30, xEnd: 110, role: 'date' },
    { xStart: 110, xEnd: 470, role: 'description' },
    { xStart: 470, xEnd: 570, role: 'amountSigned' },
  ],
  rowsStartY: 210,
};

describe('applyTemplate', () => {
  it('extracts rows defined by zones', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 240), item('VIR LOYER',     120, 240), item('-850,00', 480, 240),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' });
    expect(r.skippedRows).toHaveLength(0);
  });

  it('skips unparseable rows but keeps a record of them', () => {
    const pages = [page([
      item('15/01/2026', 40, 220), item('OK',  120, 220), item('-10,00', 480, 220),
      item('16/13/2026', 40, 240), item('BAD DATE', 120, 240), item('-1,00', 480, 240),
      item('17/01/2026', 40, 260), item('GOOD', 120, 260), item('-2,00',  480, 260),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(2);
    expect(r.skippedRows).toHaveLength(1);
    expect(r.skippedRows[0]!.reason).toMatch(/date/);
  });

  it('records skipped rows when columns miss all the row content (misaligned zones)', () => {
    // The table zone still covers the text, but the columns are drawn far to
    // the left of it — so no cell captures the date/description. The row must
    // be surfaced as skipped, not dropped silently, or a misdrawn template
    // yields an empty preview with no explanation.
    const pages = [page([
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('17/01/2026', 40, 240), item('SALAIRE', 120, 240), item('1 200,00', 480, 240),
    ])];
    const r = applyTemplate(pages, {
      ...zones,
      columns: [
        { xStart: 0, xEnd: 5, role: 'date' },
        { xStart: 5, xEnd: 10, role: 'description' },
        { xStart: 10, xEnd: 15, role: 'amountSigned' },
      ],
    });
    expect(r.rows).toEqual([]);
    expect(r.skippedRows.length).toBeGreaterThan(0);
  });

  it('honors tableRepeatsPerPage=false (later pages ignored)', () => {
    const pages = [
      page([item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220)]),
      page([item('15/02/2026', 40, 220), item('B', 120, 220), item('-2,00', 480, 220)]),
    ];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(1);
  });

  it('honors tableRepeatsPerPage=true', () => {
    const pages = [
      page([item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220)]),
      page([item('15/02/2026', 40, 220), item('B', 120, 220), item('-2,00', 480, 220)]),
    ];
    const r = applyTemplate(pages, { ...zones, tableRepeatsPerPage: true });
    expect(r.rows).toHaveLength(2);
  });

  it('with pageAnchor set, only processes pages carrying the anchor line', () => {
    // Two-account statement: pages carrying "COMPTE COURANT n° 12345" belong
    // to this template's account; pages carrying "LIVRET A n° 98765" don't.
    const withPageIndex = (idx: number, items: PdfTextItem[]): PdfPageText => ({
      pageIndex: idx, widthPt: 595, heightPt: 842,
      items: items.map((it) => ({ ...it, pageIndex: idx })),
    });
    const pages = [
      withPageIndex(0, [
        item('COMPTE COURANT n° 12345', 40, 50),
        item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220),
      ]),
      withPageIndex(1, [
        item('LIVRET A n° 98765', 40, 50),
        item('15/02/2026', 40, 220), item('B', 120, 220), item('99,00', 480, 220),
      ]),
      withPageIndex(2, [
        item('COMPTE COURANT n° 12345', 40, 50),
        item('20/01/2026', 40, 220), item('C', 120, 220), item('-2,00', 480, 220),
      ]),
    ];
    const anchored: TemplateZones = {
      ...zones,
      tableRepeatsPerPage: true,
      pageAnchor: 'compte courant n° 12345',
    };
    const r = applyTemplate(pages, anchored);
    // A and C are on anchor-bearing pages; B is on the Livret A page and is skipped.
    expect(r.rows.map((row) => row.rawLabel)).toEqual(['A', 'C']);
  });

  it('ignores an otherAnchor whose yTop is at or above rowsStartY (bogus cutoff safeguard)', () => {
    // A legacy template carries an otherAnchor line that happens to appear
    // ABOVE rowsStartY on the imported PDF (e.g. a "COMPTE Détails"
    // decoration in the page header). If applyTemplate honored it, the
    // yUpperBound would sit above the first row's Y and drop every
    // transaction. The runtime guard treats such a cutoff as "no cutoff"
    // and imports all rows.
    const withPageIndex = (idx: number, items: PdfTextItem[]): PdfPageText => ({
      pageIndex: idx, widthPt: 595, heightPt: 842,
      items: items.map((it) => ({ ...it, pageIndex: idx })),
    });
    const pages = [
      withPageIndex(0, [
        item('COMPTE COURANT n° 12345', 40, 50),
        item('COMPTE Détails', 40, 100), // above rowsStartY (210)
        item('15/01/2026', 40, 220), item('OUR-A', 120, 220), item('-1,00', 480, 220),
      ]),
    ];
    const anchored: TemplateZones = {
      ...zones,
      tableRepeatsPerPage: true,
      pageAnchor: 'compte courant n° 12345',
      // rowsStartY is inherited from `zones` above (210).
      otherAnchors: ['compte détails'], // bogus — above rowsStartY on the page
    };
    const r = applyTemplate(pages, anchored);
    // The row lands despite the bogus otherAnchor.
    expect(r.rows.map((row) => row.rawLabel)).toEqual(['OUR-A']);
  });

  it('with otherAnchors set, cuts off row processing at a mid-page account boundary', () => {
    // Page 0 belongs to us (COMPTE COURANT). Page 2 = pure other account
    // (LIVRET A) — filtered out entirely by the pageAnchor path. The
    // interesting case is page 1, which starts with our transactions and
    // ends with the start of another account's table — rows past that
    // Y must be dropped.
    const withPageIndex = (idx: number, items: PdfTextItem[]): PdfPageText => ({
      pageIndex: idx, widthPt: 595, heightPt: 842,
      items: items.map((it) => ({ ...it, pageIndex: idx })),
    });
    const pages = [
      withPageIndex(0, [
        item('COMPTE COURANT n° 12345', 40, 50),
        item('15/01/2026', 40, 220), item('OUR-A', 120, 220), item('-1,00', 480, 220),
      ]),
      withPageIndex(1, [
        item('COMPTE COURANT n° 12345', 40, 50),
        // Our rows on this page:
        item('20/01/2026', 40, 220), item('OUR-B', 120, 220), item('-2,00', 480, 220),
        item('25/01/2026', 40, 240), item('OUR-C', 120, 240), item('-3,00', 480, 240),
        // A new account starts here mid-page:
        item('LIVRET A n° 98765', 40, 400),
        // Rows below the marker belong to Livret A — must be dropped:
        item('30/01/2026', 40, 500), item('LIVRET-X', 120, 500), item('10,00', 480, 500),
        item('31/01/2026', 40, 520), item('LIVRET-Y', 120, 520), item('20,00', 480, 520),
      ]),
    ];
    const anchored: TemplateZones = {
      ...zones,
      tableRepeatsPerPage: true,
      pageAnchor: 'compte courant n° 12345',
      otherAnchors: ['livret a n° 98765'],
    };
    const r = applyTemplate(pages, anchored);
    expect(r.rows.map((row) => row.rawLabel)).toEqual(['OUR-A', 'OUR-B', 'OUR-C']);
  });

  it('legacy selectedPages emits a warning when the imported PDF has more pages than the sample', () => {
    // Template was created on a 2-page sample (selectedPages = [0, 1]); this
    // statement grew to 4 pages. Legacy indexing silently drops pages 3, 4 —
    // surface a heads-up row so the user notices.
    const withPageIndex = (idx: number, items: PdfTextItem[]): PdfPageText => ({
      pageIndex: idx, widthPt: 595, heightPt: 842,
      items: items.map((it) => ({ ...it, pageIndex: idx })),
    });
    const pages = [
      withPageIndex(0, [item('15/01/2026', 40, 220), item('A', 120, 220), item('-1,00', 480, 220)]),
      withPageIndex(1, [item('15/02/2026', 40, 220), item('B', 120, 220), item('-2,00', 480, 220)]),
      withPageIndex(2, [item('15/03/2026', 40, 220), item('C', 120, 220), item('-3,00', 480, 220)]),
      withPageIndex(3, [item('15/04/2026', 40, 220), item('D', 120, 220), item('-4,00', 480, 220)]),
    ];
    const legacy: TemplateZones = {
      ...zones,
      tableRepeatsPerPage: true,
      selectedPages: [0, 1],
    };
    const r = applyTemplate(pages, legacy);
    // Only pages 0 and 1 are processed (rows A, B).
    expect(r.rows.map((row) => row.rawLabel)).toEqual(['A', 'B']);
    // A warning row exists mentioning the untreated pages.
    const warning = r.skippedRows.find((s) => /non traitée/i.test(s.rowText));
    expect(warning).toBeTruthy();
    expect(warning!.rowText).toMatch(/3, 4/);
  });

  it('appends continuation rows (no date, has description) to the previous transaction', () => {
    const pages = [page([
      item('15/01/2026', 40, 220), item('MAGASIN U',     120, 220), item('-42,30', 480, 220),
                                   item('CARTE 4964',    120, 232),
      item('16/01/2026', 40, 250), item('RESTAURANT 27', 120, 250), item('-85,00', 480, 250),
                                   item('CARTE 4964',    120, 262),
      item('17/01/2026', 40, 280), item('SALAIRE',       120, 280), item('1 200,00', 480, 280),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]!.rawLabel).toBe('MAGASIN U CARTE 4964');
    expect(r.rows[1]!.rawLabel).toBe('RESTAURANT 27 CARTE 4964');
    expect(r.rows[2]!.rawLabel).toBe('SALAIRE');
  });

  it('skips statement balance marker rows ("Solde créditeur au …", "Nouveau solde …")', () => {
    const pages = [page([
      // top-of-table balance marker — has a date AND an amount but is not a transaction
      item('01/07/2025', 40, 215),
      item('SOLDE CREDITEUR AU 01/07/2025', 120, 215),
      item('1 500,00', 480, 215),
      // a real transaction below
      item('15/06/2026', 40, 240), item('A', 120, 240), item('-1,00', 480, 240),
      // bottom-of-table balance marker
      item('31/07/2025', 40, 280),
      item('NOUVEAU SOLDE AU 31/07/2025', 120, 280),
      item('1 499,00', 480, 280),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rawLabel).toBe('A');
  });

  it('promotes the continuation to primary when the date row is a bank-prefix line', () => {
    // CIC layout: "PAIEMENT CB ..." sits on the date row, "GREEN MOJO ..." is
    // the continuation. The bank's OFX export uses the merchant — mirror that.
    const pages = [page([
      item('15/06/2026', 40, 220),
      item('PAIEMENT CB 2506 LA BRESSE', 120, 220),
      item('-42,30', 480, 220),
                                   item('GREEN MOJO PAYWEB7883 PAIEMENT CB', 120, 232),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rawLabel).toBe('GREEN MOJO PAYWEB7883 PAIEMENT C');
    expect(r.rows[0]!.rawLabel.length).toBe(32);
  });

  it('caps rawLabel at 32 chars for OFX dedup consistency', () => {
    const pages = [page([
      item('15/01/2026', 40, 220),
      item('CASTORAMA CARTE 7883 PAIEMENT MOB', 120, 220),
      item('-42,30', 480, 220),
                                   item('0107 KINGERSH1478/', 120, 232),
    ])];
    const r = applyTemplate(pages, zones);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rawLabel).toBe('CASTORAMA CARTE 7883 PAIEMENT MO');
    expect(r.rows[0]!.rawLabel.length).toBe(32);
  });

  it('handles debit/credit column pair', () => {
    const dcZones: TemplateZones = {
      ...zones,
      columns: [
        { xStart: 30, xEnd: 110, role: 'date' },
        { xStart: 110, xEnd: 380, role: 'description' },
        { xStart: 380, xEnd: 470, role: 'debit' },
        { xStart: 470, xEnd: 570, role: 'credit' },
      ],
    };
    const pages = [page([
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 240), item('SALAIRE',       120, 240),                            item('1 200,00', 500, 240),
    ])];
    const r = applyTemplate(pages, dcZones);
    expect(r.rows.map((row) => row.amount)).toEqual(['-42.30', '1200.00']);
  });

  it('skips a debit/credit row when both columns are empty (no throw)', () => {
    // Regression: previously this hit the else-continue branch silently. The
    // test locks in that behaviour (no row emitted, no skipped-record noise).
    const dcZones: TemplateZones = {
      ...zones,
      columns: [
        { xStart: 30, xEnd: 110, role: 'date' },
        { xStart: 110, xEnd: 380, role: 'description' },
        { xStart: 380, xEnd: 470, role: 'debit' },
        { xStart: 470, xEnd: 570, role: 'credit' },
      ],
    };
    const pages = [page([
      // Real row → should be captured
      item('15/01/2026', 40, 220), item('CB', 120, 220), item('42,30', 400, 220),
      // Row with date + label but no amounts in either debit or credit column
      item('16/01/2026', 40, 240), item('EMPTY', 120, 240),
    ])];
    const r = applyTemplate(pages, dcZones);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rawLabel).toBe('CB');
  });

  it('throws when the template has no amountSigned and no debit/credit pair', () => {
    // Malformed template — description alone can't carry the amount.
    const bad: TemplateZones = {
      ...zones,
      columns: [
        { xStart: 30, xEnd: 110, role: 'date' },
        { xStart: 110, xEnd: 570, role: 'description' },
      ],
    };
    const pages = [page([
      item('15/01/2026', 40, 220), item('CB', 120, 220),
    ])];
    expect(() => applyTemplate(pages, bad)).toThrow(/invalid amount column configuration/);
  });
});
