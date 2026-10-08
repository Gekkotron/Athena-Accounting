import { describe, it, expect } from 'vitest';
import { parseQif } from '../../src/domain/imports/qif-parser.js';

const qif = (lines: string[], eol = '\n'): Buffer => Buffer.from(lines.join(eol) + eol, 'latin1');

describe('parseQif', () => {
  it('parses a single well-formed Bank transaction', () => {
    const r = parseQif(qif(['!Type:Bank', 'D06/15/2026', 'T-25.30', 'PCARREFOUR', 'MFoodstore', '^']));
    expect(r).toEqual([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARREFOUR', memo: 'Foodstore', fitid: null },
    ]);
  });

  it('parses multiple transactions terminated by ^', () => {
    const r = parseQif(qif([
      '!Type:Bank', 'D06/15/2026', 'T-25.30', 'PCARREFOUR', '^',
      'D06/16/2026', 'T100.00', 'PSALARY', '^',
    ]));
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ date: '2026-06-16', amount: '100.00', rawLabel: 'SALARY', memo: null, fitid: null });
  });

  it('populates memo from the M line and null when absent', () => {
    const r = parseQif(qif(['!Type:CCard', 'D01/02/2026', 'T-1.00', 'PX', 'Mnote', '^', 'D01/03/2026', 'T-2.00', 'PY', '^']));
    expect(r[0]!.memo).toBe('note');
    expect(r[1]!.memo).toBeNull();
  });

  it('disambiguates DD/MM/YYYY when day > 12', () => {
    const r = parseQif(qif(['!Type:Bank', 'D25/12/2026', 'T-1.00', 'PX', '^']));
    expect(r[0]!.date).toBe('2026-12-25');
  });

  it('prefers MM/DD when ambiguous and infers MM/DD when second > 12', () => {
    const r = parseQif(qif(['!Type:Bank', 'D03/04/2026', 'T-1', 'PX', '^', 'D03/25/2026', 'T-1', 'PY', '^']));
    expect(r.map((t) => t.date)).toEqual(['2026-03-04', '2026-03-25']);
  });

  it("parses US MM/DD'YY apostrophe format", () => {
    const r = parseQif(qif(["!Type:Bank", "D6/15'26", 'T-1.00', 'PX', '^', "D 6/ 5'2026", 'T-1.00', 'PY', '^']));
    expect(r.map((t) => t.date)).toEqual(['2026-06-15', '2026-06-05']);
  });

  it('parses French comma amounts', () => {
    expect(parseQif(qif(['!Type:Bank', 'D06/15/2026', 'T-25,30', 'PX', '^']))[0]!.amount).toBe('-25.30');
  });

  it('parses US thousand-separator amounts', () => {
    expect(parseQif(qif(['!Type:Bank', 'D06/15/2026', 'T-1,234.56', 'PX', '^']))[0]!.amount).toBe('-1234.56');
  });

  it('returns [] for a Cat-only file', () => {
    expect(parseQif(qif(['!Type:Cat', 'NGroceries', 'E', '^', 'NSalary', 'I', '^']))).toEqual([]);
  });

  it('skips unsupported sections but resumes on a supported one', () => {
    const r = parseQif(qif([
      '!Account', 'NChecking', 'TBank', '^',
      '!Type:Invst', 'D06/15/2026', 'T-9.00', 'PBUY', '^',
      '!Type:Bank', 'D06/16/2026', 'T-5.00', 'PX', '^',
    ]));
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe('-5.00');
  });

  it('ignores split lines and uses the top-level T amount', () => {
    const r = parseQif(qif([
      '!Type:Bank', 'D06/15/2026', 'T-100.00', 'PSTORE', 'N1234',
      'SFood', '$-60.00', 'EA', 'SHome', '$-40.00', 'EB', '^',
    ]));
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe('-100.00');
    expect(r[0]!.fitid).toBeNull();
  });

  it('skips transactions missing D or T silently', () => {
    const r = parseQif(qif([
      '!Type:Bank', 'T-1.00', 'PNoDate', '^',
      'D06/15/2026', 'PNoAmount', '^',
      'D06/16/2026', 'T-2.00', 'POk', '^',
    ]));
    expect(r).toHaveLength(1);
    expect(r[0]!.rawLabel).toBe('Ok');
  });

  it('throws on a malformed date', () => {
    expect(() => parseQif(qif(['!Type:Bank', 'Dgarbage', 'T-1.00', 'PX', '^']))).toThrow(/invalid QIF date/);
  });

  it('throws on a malformed amount', () => {
    expect(() => parseQif(qif(['!Type:Bank', 'D06/15/2026', 'Tabc', 'PX', '^']))).toThrow(/invalid QIF amount/);
  });

  it.each([['\r\n'], ['\n'], ['\r']])('tolerates line ending %j', (eol) => {
    const r = parseQif(qif(['!Type:Bank', 'D06/15/2026', 'T-25.30', 'PX', '^', 'D06/16/2026', 'T1.00', 'PY', '^'], eol));
    expect(r).toHaveLength(2);
  });

  it('returns [] for an empty file', () => {
    expect(parseQif(Buffer.alloc(0))).toEqual([]);
  });
});
