import { describe, it, expect } from 'vitest';
import { parseMt940 } from '../../src/domain/imports/mt940-parser.js';

// Synthetic MT940 fixtures. No real bank statement is ever committed.

function mt940(lines: string[], eol = '\n'): Buffer {
  return Buffer.from(lines.join(eol) + eol, 'utf-8');
}

function stmt(body: string[]): string[] {
  return [':20:REF', ':25:40010010/12345678', ':28C:1/1', ':60F:C260615EUR1000,00', ...body, ':62F:C260616EUR1000,00', '-'];
}

describe('parseMt940', () => {
  it('parses a debit as a negative amount', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D25,30NTRFNONREF', ':86:SHOP'])));
    expect(out).toEqual([{ date: '2026-06-15', amount: '-25.30', rawLabel: 'SHOP', memo: null, fitid: null }]);
  });

  it('parses a credit as a positive amount', () => {
    const out = parseMt940(mt940(stmt([':61:2606160616C100,00NTRFNONREF', ':86:SALARY'])));
    expect(out[0]!.amount).toBe('100.00');
    expect(out[0]!.date).toBe('2026-06-16');
  });

  it('handles reversals and optional funds code / entry date', () => {
    const out = parseMt940(
      mt940(
        stmt([
          ':61:260615RD10,00NTRFNONREF',
          ':86:A',
          ':61:2606150615RC20,50NTRFNONREF',
          ':86:B',
          ':61:2606150615DR25,30NTRFNONREF',
          ':86:C',
        ]),
      ),
    );
    expect(out.map((t) => t.amount)).toEqual(['10.00', '-20.50', '-25.30']);
  });

  it('strips ?NN? subfield markers and joins with spaces', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D5,00NTRFNONREF', ':86:166?00KARTE?20CARREFOUR?21MULHOUSE?32X'])));
    expect(out[0]!.rawLabel).toBe('166 KARTE CARREFOUR MULHOUSE X');
    const out2 = parseMt940(mt940(stmt([':61:2606150615D5,00NTRFNONREF', ':86:?20?CARREFOUR?21?MULHOUSE'])));
    expect(out2[0]!.rawLabel).toBe('CARREFOUR MULHOUSE');
  });

  it('joins multi-line narratives', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D5,00NTRFNONREF', ':86:LINE ONE', 'LINE TWO'])));
    expect(out[0]!.rawLabel).toBe('LINE ONE LINE TWO');
  });

  it('uses the supplement line as label when :86: is missing', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D5,00NTRFNONREF', 'Supplement text'])));
    expect(out[0]!.rawLabel).toBe('Supplement text');
  });

  it('falls back to the type code when there is no narrative', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D5,00NMSCNONREF'])));
    expect(out[0]!.rawLabel).toBe('NMSC');
  });

  it('parses back-to-back transactions with their own labels', () => {
    const out = parseMt940(
      mt940(
        stmt([
          ':61:2606150615D1,00NTRFNONREF',
          ':86:ONE',
          ':61:2606160616C2,00NTRFNONREF',
          ':86:TWO',
          ':61:2606170617D3,00NTRFNONREF',
          'sup three',
        ]),
      ),
    );
    expect(out.map((t) => t.rawLabel)).toEqual(['ONE', 'TWO', 'sup three']);
  });

  it('derives fitid from bank ref, then customer ref, else null', () => {
    const out = parseMt940(
      mt940(
        stmt([
          ':61:2606150615D1,00NTRFNONREF//RefA',
          ':86:A',
          ':61:2606150615D1,00NTRFCUST1//',
          ':86:B',
          ':61:2606150615D1,00NTRFCUST2',
          ':86:C',
          ':61:2606150615D1,00NTRFNONREF',
          ':86:D',
          ':61:2606150615D1,00NTRF',
          ':86:E',
        ]),
      ),
    );
    expect(out.map((t) => t.fitid)).toEqual(['RefA', 'CUST1', 'CUST2', null, null]);
  });

  it('applies the century rule to 2-digit years', () => {
    const out = parseMt940(mt940([':61:8001020102C1,00NTRF', ':61:7912312231C1,00NTRF', ':61:2606150615C1,00NTRF']));
    expect(out.map((t) => t.date)).toEqual(['1980-01-02', '2079-12-31', '2026-06-15']);
  });

  it('converts comma decimals to 2-decimal dot amounts', () => {
    const out = parseMt940(mt940([':61:2606150615C25,3NTRF', ':61:2606150615C1234,NTRF', ':61:2606150615C7NTRF']));
    expect(out.map((t) => t.amount)).toEqual(['25.30', '1234.00', '7.00']);
  });

  it('ignores a statement-level :86: after the closing balance', () => {
    const out = parseMt940(mt940(stmt([':61:2606150615D5,00NTRFNONREF', ':86:REAL']).slice(0, -1).concat([':86:STATEMENT INFO', '-'])));
    expect(out).toHaveLength(1);
    expect(out[0]!.rawLabel).toBe('REAL');
  });

  it('parses multi-message files', () => {
    const out = parseMt940(
      mt940([...stmt([':61:2606150615D1,00NTRFNONREF', ':86:M1']), ...stmt([':61:2606160616C2,00NTRFNONREF', ':86:M2'])]),
    );
    expect(out.map((t) => t.rawLabel)).toEqual(['M1', 'M2']);
  });

  it('preserves UTF-8 accents and falls back to windows-1252', () => {
    const utf = parseMt940(mt940(stmt([':61:2606150615D1,00NTRFNONREF', ':86:Müller Café'])));
    expect(utf[0]!.rawLabel).toBe('Müller Café');
    const head = Buffer.from(':61:2606150615D1,00NTRFNONREF\n:86:M', 'latin1');
    const legacy = Buffer.concat([head, Buffer.from([0xfc]), Buffer.from('ller\n', 'latin1')]);
    expect(parseMt940(legacy)[0]!.rawLabel).toBe('Müller');
  });

  it('returns [] when there are no :61: tags', () => {
    expect(parseMt940(mt940([':20:REF', ':25:ACC', ':60F:C260615EUR1,00', ':62F:C260615EUR1,00', '-']))).toEqual([]);
    expect(parseMt940(Buffer.alloc(0))).toEqual([]);
  });

  it('throws on a malformed :61: line', () => {
    expect(() => parseMt940(mt940([':61:2606150615DNTRFNONREF']))).toThrow(/invalid MT940 statement line/);
  });

  it('tolerates CRLF, LF and bare CR line endings', () => {
    const lines = stmt([':61:2606150615D5,00NTRFNONREF//R1', ':86:LBL']);
    for (const eol of ['\r\n', '\n', '\r']) {
      const out = parseMt940(mt940(lines, eol));
      expect(out).toEqual([{ date: '2026-06-15', amount: '-5.00', rawLabel: 'LBL', memo: null, fitid: 'R1' }]);
    }
  });
});
