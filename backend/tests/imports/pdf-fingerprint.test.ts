import { describe, it, expect } from 'vitest';
import {
  fingerprintHeader,
  fingerprintFromZone,
  defaultHeaderZone,
} from '../../src/domain/imports/pdf/fingerprint.js';
import type { PdfPageText, PdfTextItem } from '../../src/domain/imports/pdf/text-extract.js';

function item(str: string, xLeft: number, yTop: number): PdfTextItem {
  return { pageIndex: 0, str, xLeft, yTop, width: str.length * 5, height: 10 };
}

function page(items: PdfTextItem[]): PdfPageText {
  return { pageIndex: 0, widthPt: 595, heightPt: 842, items };
}

describe('fingerprintHeader', () => {
  it('is stable across statements with different dates and balances', () => {
    const jan = page([
      item('BANQUE EXAMPLE', 40, 30),
      item('Relevé de compte n° 12345', 40, 60),
      item('Période: 01/01/2026 - 31/01/2026', 40, 90),
      item('Solde: 1 234,56 EUR', 40, 120),
    ]);
    const feb = page([
      item('BANQUE EXAMPLE', 40, 30),
      item('Relevé de compte n° 67890', 40, 60),
      item('Période: 01/02/2026 - 28/02/2026', 40, 90),
      item('Solde: 2 998,17 EUR', 40, 120),
    ]);
    expect(fingerprintHeader(jan)).toBe(fingerprintHeader(feb));
  });

  it('differs between different banks', () => {
    const a = page([item('BANQUE A', 40, 30), item('Le relevé', 40, 60)]);
    const b = page([item('BANK B', 40, 30), item('Statement', 40, 60)]);
    expect(fingerprintHeader(a)).not.toBe(fingerprintHeader(b));
  });

  it('ignores diacritics, case, and whitespace runs', () => {
    const a = page([item('BANQUE EXAMPLE  Relevé', 40, 30)]);
    const b = page([item('banque example releve', 40, 30)]);
    expect(fingerprintHeader(a)).toBe(fingerprintHeader(b));
  });

  it('defaultHeaderZone returns the top 15% of the page', () => {
    const p = page([]);
    const z = defaultHeaderZone(p);
    expect(z).toEqual({ page: 0, x: 0, y: 0, w: 595, h: 842 * 0.15 });
  });
});
