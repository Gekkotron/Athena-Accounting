import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('heuristic ↔ template-apply round trip', () => {
  it('signed-amount table: heuristic output equals template-apply output', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
      item('16/01/2026', 40, 235), item('VIR LOYER',     120, 235), item('-850,00', 480, 235),
      item('17/01/2026', 40, 250), item('SALAIRE',       120, 250), item('1 200,00', 480, 250),
    ])];
    const h = runHeuristic(pages);
    expect(h.confidence).toBeGreaterThanOrEqual(0.9);
    const t = applyTemplate(pages, h.zones!);
    expect(t.rows).toEqual(h.rows);
  });

  it('débit/crédit table: round trip stable', () => {
    const pages = [page([
      item('Date', 40, 200), item('Libellé', 120, 200), item('Débit', 400, 200), item('Crédit', 500, 200),
      item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('42,30', 400, 220),
      item('17/01/2026', 40, 240), item('SALAIRE',       120, 240),                            item('1 200,00', 500, 240),
    ])];
    const h = runHeuristic(pages);
    const t = applyTemplate(pages, h.zones!);
    expect(t.rows).toEqual(h.rows);
  });
});
