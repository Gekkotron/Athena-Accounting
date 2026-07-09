import { describe, it, expect } from 'vitest';
import { runHeuristic } from '../../src/domain/imports/pdf/heuristic.js';
import { applyTemplate } from '../../src/domain/imports/pdf/template-apply.js';
import { parseStatementRows } from '../../src/domain/imports/pdf/parse-rows.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}
function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}
const goodPages = [page([
  item('Date', 40, 200), item('Libellé', 120, 200), item('Montant', 480, 200),
  item('15/01/2026', 40, 220), item('CB CARREFOUR', 120, 220), item('-42,30', 480, 220),
  item('16/01/2026', 40, 235), item('VIR LOYER', 120, 235), item('-850,00', 480, 235),
])];

describe('parseStatementRows', () => {
  it('returns parsed rows equal to applyTemplate output for a working template', () => {
    const h = runHeuristic(goodPages);
    const res = parseStatementRows(goodPages, h.zones!);
    expect(res.kind).toBe('parsed');
    if (res.kind === 'parsed') {
      expect(res.rows).toEqual(applyTemplate(goodPages, h.zones!).rows);
      expect(res.rows.length).toBe(2);
    }
  });

  it('returns stale when the template yields zero rows', () => {
    const h = runHeuristic(goodPages);
    const empty = [page([item('nothing', 10, 10)])];
    const res = parseStatementRows(empty, h.zones!);
    expect(res.kind).toBe('stale');
  });
});
