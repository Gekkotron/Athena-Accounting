import { describe, it, expect } from 'vitest';
import { diagnoseStaleTemplate, flattenItems } from '../src/domain/imports/pdf/diagnose.js';
import type { PdfPageText, PdfTextItem } from '../src/domain/imports/pdf/text-extract.js';
import type { TemplateZones } from '../src/domain/imports/pdf/zones.js';

// Minimal `PdfPageText` builder for the diagnostic. `pageContainsAnchor` runs
// a substring match against the joined page text — the shape of the items
// list matters only insofar as their `str` fields concatenate to something
// the anchor probes.
const page = (strs: string[]): PdfPageText => ({
  pageIndex: 0,
  widthPt: 595,
  heightPt: 842,
  items: strs.map(
    (str, i): PdfTextItem => ({
      str,
      pageIndex: 0,
      xLeft: 10,
      yTop: 100 + i * 12,
      width: 100,
      height: 10,
    }),
  ),
});

const baseZones = (over: Partial<TemplateZones> = {}): TemplateZones => ({
  headerZone: { page: 0, x: 0, y: 0, w: 595, h: 100 },
  tableZone: { page: 0, x: 20, y: 200, w: 555, h: 500 },
  tableRepeatsPerPage: true,
  columns: [
    { xStart: 20, xEnd: 80, role: 'date' },
    { xStart: 90, xEnd: 400, role: 'description' },
    { xStart: 410, xEnd: 570, role: 'amountSigned' },
  ],
  rowsStartY: 200,
  ...over,
});

describe('flattenItems', () => {
  it('concatenates items across pages, preserving order', () => {
    const p1 = page(['A', 'B']);
    const p2 = page(['C']);
    p2.pageIndex = 1;
    for (const it of p2.items) it.pageIndex = 1;
    const items = flattenItems([p1, p2]);
    expect(items.map((i) => i.str)).toEqual(['A', 'B', 'C']);
  });

  it('returns [] for an empty pages array', () => {
    expect(flattenItems([])).toEqual([]);
  });
});

describe('diagnoseStaleTemplate', () => {
  it('flags a missing pageAnchor when none of the pages contain it', () => {
    const zones = baseZones({ pageAnchor: 'COMPTE COURANT 12345' });
    const pages = [page(['random header', 'unrelated line'])];
    const msg = diagnoseStaleTemplate(pages, zones, []);
    expect(msg).toContain('COMPTE COURANT 12345');
    expect(msg).toContain("n'a été trouvée sur aucune");
  });

  it('flags an overrun warning when a skippedRow mentions "non traitée"', () => {
    const zones = baseZones();
    const pages = [page(['ok line'])];
    const skipped = [{ rowText: 'page 5 non traitée', reason: 'overrun' }];
    const msg = diagnoseStaleTemplate(pages, zones, skipped);
    expect(msg).toContain('numéros de page absolus');
  });

  it('falls back to a generic "no rows produced" message when neither branch applies', () => {
    const zones = baseZones({ pageAnchor: 'ANCRE' });
    const pages = [page(['ANCRE présente ici'])];
    const msg = diagnoseStaleTemplate(pages, zones, []);
    expect(msg).toContain('aucune ligne');
  });

  it('bypasses the anchor branch when pageAnchor is empty or whitespace-only', () => {
    const withEmpty = baseZones({ pageAnchor: '' });
    const withSpace = baseZones({ pageAnchor: '   ' });
    for (const zones of [withEmpty, withSpace]) {
      const msg = diagnoseStaleTemplate([page(['x'])], zones, []);
      expect(msg).not.toContain("n'a été trouvée sur aucune");
    }
  });
});
