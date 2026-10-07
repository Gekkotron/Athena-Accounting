import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../heuristic.js';
import type { PdfPageText, PdfTextItem } from '../text-extract.js';

const X_DATE = 20;
const X_DESC = 120;
const X_A = 320;
const X_B = 420;

const it_ = (str: string, xLeft: number, yTop: number, pageIndex = 0): PdfTextItem => ({
  pageIndex, str, xLeft, yTop, width: 40, height: 10,
});

const mkPage = (items: PdfTextItem[], pageIndex = 0): PdfPageText => ({
  pageIndex, widthPt: 600, heightPt: 800, items,
});

// Signed-amount layout: date | description | amount
const signedRow = (y: number, date: string, desc: string, amount: string, p = 0): PdfTextItem[] => [
  it_(date, X_DATE, y, p), it_(desc, X_DESC, y, p), it_(amount, X_A, y, p),
];

// Débit/crédit layout: date | description | débit | crédit
const pairRow = (y: number, date: string, desc: string, debit: string, credit: string, p = 0): PdfTextItem[] => {
  const out = [it_(date, X_DATE, y, p), it_(desc, X_DESC, y, p)];
  if (debit) out.push(it_(debit, X_A, y, p));
  if (credit) out.push(it_(credit, X_B, y, p));
  return out;
};

describe('runHeuristic — bail-out paths', () => {
  it('no pages → null zones, confidence 0', () => {
    expect(runHeuristic([])).toEqual({ zones: null, rows: [], confidence: 0, skippedRows: [] });
  });

  it('empty first page → null zones', () => {
    expect(runHeuristic([mkPage([])]).zones).toBeNull();
  });

  it('single visual row → not enough to infer a table', () => {
    const r = runHeuristic([mkPage(signedRow(100, '01/07/2025', 'CARTE', '-12,50'))]);
    expect(r.zones).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('no date-like column → null zones', () => {
    const items = [
      it_('Bonjour', X_DATE, 10), it_('Monde', X_DESC, 10),
      it_('Texte', X_DATE, 30), it_('Autre', X_DESC, 30),
    ];
    expect(runHeuristic([mkPage(items)]).zones).toBeNull();
  });

  it('date column but no amount column → null zones', () => {
    const items = [
      it_('01/07/2025', X_DATE, 10), it_('CARTE', X_DESC, 10),
      it_('02/07/2025', X_DATE, 30), it_('VIR', X_DESC, 30),
    ];
    expect(runHeuristic([mkPage(items)]).zones).toBeNull();
  });
});

describe('runHeuristic — signed amount layout', () => {
  const items = [
    it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
    ...signedRow(130, '01/07/2025', 'CARTE MAGASIN U', '-12,50'),
    ...signedRow(150, '02/07/2025', 'VIR SALAIRE', '1 234,56'),
  ];
  const r = runHeuristic([mkPage(items)]);

  it('detects date, description and amountSigned column roles', () => {
    expect(r.zones).not.toBeNull();
    const roles = r.zones!.columns.map((c) => c.role);
    expect(roles).toEqual(['date', 'description', 'amountSigned']);
  });

  it('parses French dates and decimal amounts', () => {
    expect(r.rows.map((x) => [x.date, x.amount, x.rawLabel])).toEqual([
      ['2025-07-01', '-12.50', 'CARTE MAGASIN U'],
      ['2025-07-02', '1234.56', 'VIR SALAIRE'],
    ]);
  });

  it('reports full confidence and no skipped rows', () => {
    expect(r.confidence).toBe(1);
    expect(r.skippedRows).toEqual([]);
  });

  it('sets rowsStartY just above the first dated row', () => {
    expect(r.zones!.rowsStartY).toBe(129);
    expect(r.zones!.tableRepeatsPerPage).toBe(false);
  });

  it('header zone is the top 15% of the page', () => {
    expect(r.zones!.headerZone).toEqual({ page: 0, x: 0, y: 0, w: 600, h: 120 });
  });
});

describe('runHeuristic — débit/crédit layout', () => {
  const items = [
    it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Débit', X_A, 100), it_('Crédit', X_B, 100),
    ...pairRow(130, '01/07/2025', 'CARTE RESTO', '25,00', ''),
    ...pairRow(150, '02/07/2025', 'VIR REMBOURSEMENT', '', '40,00'),
    ...pairRow(170, '03/07/2025', 'PRLV EDF', '60,10', ''),
  ];
  const r = runHeuristic([mkPage(items)]);

  it('assigns debit and credit roles', () => {
    expect(r.zones!.columns.map((c) => c.role)).toEqual(['date', 'description', 'debit', 'credit']);
  });

  it('debits become negative, credits stay positive', () => {
    expect(r.rows.map((x) => x.amount)).toEqual(['-25.00', '40.00', '-60.10']);
  });
});

describe('runHeuristic — row filtering and continuation', () => {
  it('skips balance and footer lines', () => {
    const items = [
      it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
      ...signedRow(130, '01/07/2025', 'ANCIEN SOLDE', '500,00'),
      ...signedRow(150, '02/07/2025', 'CARTE ALPHA', '-10,00'),
      it_('Sous réserve des extournes', X_DESC, 170),
      ...signedRow(190, '03/07/2025', 'NOUVEAU SOLDE', '490,00'),
    ];
    const r = runHeuristic([mkPage(items)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.rawLabel).toBe('CARTE ALPHA');
  });

  it('merges an undated continuation row into the previous label', () => {
    const items = [
      it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
      ...signedRow(130, '01/07/2025', 'MAGASIN U', '-12,50'),
      it_('CARTE 4964', X_DESC, 142),
      ...signedRow(170, '02/07/2025', 'BOULANGERIE', '-3,20'),
    ];
    const r = runHeuristic([mkPage(items)]);
    expect(r.rows.map((x) => x.rawLabel)).toEqual(['MAGASIN U CARTE 4964', 'BOULANGERIE']);
  });

  it('truncates labels to the 32-char OFX cap', () => {
    const items = [
      it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
      ...signedRow(130, '01/07/2025', 'A'.repeat(50), '-1,00'),
      ...signedRow(150, '02/07/2025', 'B', '-2,00'),
    ];
    expect(runHeuristic([mkPage(items)]).rows[0]!.rawLabel).toHaveLength(32);
  });

  it('records unparseable dates as skipped and lowers confidence', () => {
    const items = [
      it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
      ...signedRow(130, '01/07/2025', 'OK ONE', '-1,00'),
      ...signedRow(150, '02/07/2025', 'OK TWO', '-2,00'),
      ...signedRow(170, '31/13/2025', 'BAD MONTH', '-3,00'),
    ];
    const r = runHeuristic([mkPage(items)]);
    expect(r.rows).toHaveLength(2);
    expect(r.skippedRows).toHaveLength(1);
    expect(r.skippedRows[0]!.reason).toContain('unparseable date');
    expect(r.confidence).toBeCloseTo(2 / 3, 5);
  });
});

describe('runHeuristic — multi-page', () => {
  const p1 = [
    it_('Date', X_DATE, 100), it_('Libellé', X_DESC, 100), it_('Montant', X_A, 100),
    ...signedRow(130, '01/07/2025', 'PAGE ONE A', '-1,00'),
    ...signedRow(150, '02/07/2025', 'PAGE ONE B', '-2,00'),
  ];

  it('marks tableRepeatsPerPage and extracts rows from later pages', () => {
    const p2 = [
      ...signedRow(30, '03/07/2025', 'PAGE TWO A', '-3,00', 1),
      ...signedRow(50, '04/07/2025', 'PAGE TWO B', '-4,00', 1),
    ];
    const r = runHeuristic([mkPage(p1), mkPage(p2, 1)]);
    expect(r.zones!.tableRepeatsPerPage).toBe(true);
    expect(r.rows.map((x) => x.rawLabel)).toEqual(['PAGE ONE A', 'PAGE ONE B', 'PAGE TWO A', 'PAGE TWO B']);
  });

  it('ignores later pages that carry no dated rows', () => {
    const p2 = [it_('Mentions légales', X_DESC, 30, 1), it_('Page 2/2', X_DESC, 50, 1)];
    const r = runHeuristic([mkPage(p1), mkPage(p2, 1)]);
    expect(r.zones!.tableRepeatsPerPage).toBe(false);
    expect(r.rows).toHaveLength(2);
  });
});
