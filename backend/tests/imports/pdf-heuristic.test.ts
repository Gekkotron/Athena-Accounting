import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('runHeuristic', () => {
  it('detects a signed-amount table with high confidence', () => {
    const items: PdfTextItem[] = [
      item('Banque Example', 40, 30),
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 235), item('VIR LOYER',     120, 235), item('-850,00', 480, 235),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250), item('1 200,00', 480, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      date: '2026-01-15',
      amount: '-42.30',
      rawLabel: 'CB CARREFOUR',
    });
    expect(result.rows[2]!.amount).toBe('1200.00');
    expect(result.zones).not.toBeNull();
    expect(result.zones!.columns.find((c) => c.role === 'date')).toBeDefined();
    expect(result.zones!.columns.find((c) => c.role === 'amountSigned')).toBeDefined();
  });

  it('detects a débit/crédit pair with positive credit, negative debit', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200),
      item('Débit', 400, 200), item('Crédit', 500, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250),                            item('1 200,00', 500, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.rows.map((r) => r.amount)).toEqual(['-42.30', '1200.00']);
  });

  it('returns confidence 0 when no rows parse', () => {
    const result = runHeuristic([page([item('Just some marketing text', 40, 200)])]);
    expect(result.confidence).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('returns suggestedZones for medium-confidence input', () => {
    // 3 well-formed rows + 2 garbage rows mixed in → confidence ~ 0.6
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('reportable', 40, 235), item('-', 120, 235), item('-', 480, 235),
      item('16/01/2026', 40, 250), item('VIR LOYER',     120, 250), item('-850,00', 480, 250),
      item('also bad', 40, 265), item('???', 120, 265), item('???', 480, 265),
      item('17/01/2026', 40, 280), item('SALAIRE',       120, 280), item('1 200,00', 480, 280),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.zones).not.toBeNull();
  });

  it('treats date-less description rows as continuation of the previous transaction', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('MAGASIN U',     120, 220), item('-42,30', 480, 220),
                                   item('CARTE 4964',    120, 232),
      item('16/01/2026', 40, 250), item('RESTAURANT 27', 120, 250), item('-85,00', 480, 250),
                                   item('CARTE 4964',    120, 262),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.rawLabel).toBe('MAGASIN U CARTE 4964');
    expect(result.rows[1]!.rawLabel).toBe('RESTAURANT 27 CARTE 4964');
  });

  it('skips statement balance marker rows', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('01/07/2025', 40, 215),
      item('SOLDE CREDITEUR AU 01/07/2025', 120, 215),
      item('1 500,00', 480, 215),
      item('15/06/2026', 40, 240), item('A', 120, 240), item('-1,00', 480, 240),
      item('16/06/2026', 40, 260), item('B', 120, 260), item('-2,00', 480, 260),
      item('31/07/2025', 40, 290),
      item('NOUVEAU SOLDE AU 31/07/2025', 120, 290),
      item('1 497,00', 480, 290),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.rawLabel)).toEqual(['A', 'B']);
  });

  it('promotes the continuation to primary when the date row is a bank-prefix line', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/06/2026', 40, 220),
      item('PAIEMENT CB 2506 LA BRESSE', 120, 220),
      item('-42,30', 480, 220),
                                   item('GREEN MOJO PAYWEB7883 PAIEMENT CB', 120, 232),
      item('16/06/2026', 40, 250), item('A', 120, 250), item('-1,00', 480, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.rawLabel).toBe('GREEN MOJO PAYWEB7883 PAIEMENT C');
    expect(result.rows[0]!.rawLabel.length).toBe(32);
  });

  it('caps rawLabel at 32 chars for OFX dedup consistency', () => {
    const items: PdfTextItem[] = [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220),
      item('CASTORAMA CARTE 7883 PAIEMENT MOB', 120, 220),
      item('-42,30', 480, 220),
                                   item('0107 KINGERSH1478/', 120, 232),
      item('16/01/2026', 40, 250), item('A', 120, 250), item('-1,00', 480, 250),
    ];
    const result = runHeuristic([page(items)]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.rawLabel).toBe('CASTORAMA CARTE 7883 PAIEMENT MO');
    expect(result.rows[0]!.rawLabel.length).toBe(32);
  });

  it('handles multi-page repeating tables', () => {
    const tableRows = (yStart: number) => [
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, yStart),     item('A', 120, yStart),     item('-1,00', 480, yStart),
      item('16/01/2026', 40, yStart + 15), item('B', 120, yStart + 15), item('-2,00', 480, yStart + 15),
    ];
    const pages: PdfPageText[] = [page(tableRows(220)), page(tableRows(220))];
    const result = runHeuristic(pages);
    expect(result.rows).toHaveLength(4);
    expect(result.zones!.tableRepeatsPerPage).toBe(true);
  });
});
