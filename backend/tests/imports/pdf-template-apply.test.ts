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
});
