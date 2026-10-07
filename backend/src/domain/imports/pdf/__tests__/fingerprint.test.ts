import { describe, it, expect } from 'vitest';
import { defaultHeaderZone, fingerprintFromZone, fingerprintHeader } from '../fingerprint.js';
import type { PdfPageText } from '../text-extract.js';

const item = (str: string, xLeft: number, yTop: number) => ({
  pageIndex: 0, str, xLeft, yTop, width: 10, height: 10,
});

const page = (items: ReturnType<typeof item>[], widthPt = 600, heightPt = 800): PdfPageText => ({
  pageIndex: 0, widthPt, heightPt, items,
});

describe('defaultHeaderZone', () => {
  it('covers the full width and the top 15% of the page', () => {
    const z = defaultHeaderZone(page([], 600, 800));
    expect(z).toEqual({ page: 0, x: 0, y: 0, w: 600, h: 120 });
  });
});

describe('fingerprintHeader', () => {
  it('returns a 64-char hex sha256', () => {
    const fp = fingerprintHeader(page([item('Banque', 10, 10)]));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable when only digits change (dates, balances, account numbers)', () => {
    const a = fingerprintHeader(page([item('Relevé du 01/07/2025', 10, 10), item('Compte 12345', 10, 30)]));
    const b = fingerprintHeader(page([item('Relevé du 01/08/2025', 10, 10), item('Compte 98765', 10, 30)]));
    expect(a).toBe(b);
  });

  it('ignores case, accents and whitespace differences', () => {
    const a = fingerprintHeader(page([item('Relevé de Compte', 10, 10)]));
    const b = fingerprintHeader(page([item('RELEVE   DE  COMPTE', 10, 10)]));
    expect(a).toBe(b);
  });

  it('differs for a different bank header text', () => {
    const a = fingerprintHeader(page([item('Banque Alpha', 10, 10)]));
    const b = fingerprintHeader(page([item('Banque Beta', 10, 10)]));
    expect(a).not.toBe(b);
  });

  it('ignores items below the header zone', () => {
    const a = fingerprintHeader(page([item('Banque', 10, 10)]));
    const b = fingerprintHeader(page([item('Banque', 10, 10), item('Libellé opération', 10, 500)]));
    expect(a).toBe(b);
  });

  it('is independent of item input order (sorted by y then x)', () => {
    const a = fingerprintHeader(page([item('Alpha', 10, 10), item('Beta', 10, 40), item('Gamma', 200, 40)]));
    const b = fingerprintHeader(page([item('Gamma', 200, 40), item('Beta', 10, 40), item('Alpha', 10, 10)]));
    expect(a).toBe(b);
  });
});

describe('fingerprintFromZone', () => {
  it('only includes items inside the zone rectangle (inclusive bounds)', () => {
    const p = page([item('inside', 50, 50), item('edge', 100, 100), item('outsideX', 101, 50), item('outsideY', 50, 101)]);
    const zone = { page: 0, x: 0, y: 0, w: 100, h: 100 };
    const expected = fingerprintFromZone(page([item('inside', 50, 50), item('edge', 100, 100)]), zone);
    expect(fingerprintFromZone(p, zone)).toBe(expected);
  });

  it('empty zone yields the hash of the empty string', () => {
    const fp = fingerprintFromZone(page([item('x', 500, 500)]), { page: 0, x: 0, y: 0, w: 10, h: 10 });
    expect(fp).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
