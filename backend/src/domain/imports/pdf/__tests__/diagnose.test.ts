import { describe, it, expect } from 'vitest';
import { flattenItems, diagnoseStaleTemplate } from '../diagnose.js';
import type { PdfPageText } from '../text-extract.js';
import type { TemplateZones } from '../zones.js';

const item = (pageIndex: number, str: string, yTop = 10) => ({
  pageIndex, str, xLeft: 0, yTop, width: 10, height: 10,
});

const page = (pageIndex: number, strs: string[]): PdfPageText => ({
  pageIndex, widthPt: 600, heightPt: 800,
  items: strs.map((s, i) => item(pageIndex, s, 10 + i * 20)),
});

const zones = (extra: Partial<TemplateZones> = {}): TemplateZones => ({
  headerZone: { page: 0, x: 0, y: 0, w: 600, h: 120 },
  tableZone: { page: 0, x: 0, y: 120, w: 600, h: 680 },
  tableRepeatsPerPage: false,
  columns: [],
  rowsStartY: 120,
  ...extra,
});

describe('flattenItems', () => {
  it('concatenates items of all pages in page order', () => {
    const out = flattenItems([page(0, ['a', 'b']), page(1, ['c'])]);
    expect(out.map((i) => i.str)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for no pages', () => {
    expect(flattenItems([])).toEqual([]);
  });
});

describe('diagnoseStaleTemplate', () => {
  it('reports a missing anchor with the anchor text and page count', () => {
    const msg = diagnoseStaleTemplate(
      [page(0, ['Autre texte']), page(1, ['Rien'])],
      zones({ pageAnchor: 'Compte Courant n° 12345' }),
      [],
    );
    expect(msg).toContain('Compte Courant n° 12345');
    expect(msg).toContain('2 pages');
  });

  it('does not report the anchor problem when the anchor is present on a page', () => {
    const msg = diagnoseStaleTemplate(
      [page(0, ['Livret A n° 98765'])],
      zones({ pageAnchor: 'livret a n° 98765' }),
      [],
    );
    expect(msg).not.toContain("L'ancre");
    expect(msg).toContain("n'a produit aucune ligne");
  });

  it('ignores a blank pageAnchor', () => {
    const msg = diagnoseStaleTemplate([page(0, ['x'])], zones({ pageAnchor: '   ' }), []);
    expect(msg).toContain("n'a produit aucune ligne");
  });

  it('reports absolute page numbers when a skipped row says "non traitée"', () => {
    const msg = diagnoseStaleTemplate(
      [page(0, ['x'])],
      zones(),
      [{ rowText: 'Page 4 Non Traitée', reason: 'overrun' }],
    );
    expect(msg).toContain('numéros de page absolus');
  });

  it('anchor-missing diagnosis wins over the overrun diagnosis', () => {
    const msg = diagnoseStaleTemplate(
      [page(0, ['x'])],
      zones({ pageAnchor: 'introuvable ancre' }),
      [{ rowText: 'page non traitée', reason: 'overrun' }],
    );
    expect(msg).toContain("L'ancre");
  });

  it('falls back to the generic message', () => {
    const msg = diagnoseStaleTemplate([page(0, ['x'])], zones(), [{ rowText: 'foo', reason: 'bar' }]);
    expect(msg).toContain("n'a produit aucune ligne");
  });
});
