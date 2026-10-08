import { describe, it, expect } from 'vitest';
import { parseBai2 } from '../../src/domain/imports/bai2-parser.js';

// Synthetic BAI2 fixtures. No real bank statement is ever committed.

function bai2(lines: string[], eol = '\n'): Buffer {
  return Buffer.from(lines.join(eol) + eol, 'utf-8');
}

function file(body: string[], asOf = '260615'): string[] {
  return [
    '01,SENDERID,RECEIVERID,260615,0800,000001,80,1,2/',
    `02,RECEIVERID,SENDERID,1,${asOf},0800,USD,2/`,
    '03,123456789,USD,010,100000,,,015,100000,,,/',
    ...body,
    '49,2000000,3/',
    '98,2000000,1,5/',
    '99,2000000,1,7/',
  ];
}

function one(line: string, asOf = '260615') {
  return parseBai2(bai2(file([line], asOf)));
}

describe('parseBai2', () => {
  it('parses a minimal credit with the date from the 02 header', () => {
    const out = one('16,301,10000,Z,,,SALARY DEPOSIT/');
    expect(out).toEqual([{ date: '2026-06-15', amount: '100.00', rawLabel: 'SALARY DEPOSIT', memo: null, fitid: null }]);
  });

  it('parses a debit as negative', () => {
    expect(one('16,475,2530,Z,,,SHOP/')[0]!.amount).toBe('-25.30');
  });

  it.each([
    ['100', '1.00'],
    ['399', '1.00'],
    ['400', '-1.00'],
    ['699', '-1.00'],
  ])('type %s gives amount %s', (code, expected) => {
    expect(one(`16,${code},100,Z,,,X/`)[0]!.amount).toBe(expected);
  });

  it.each(['750', '905', '099', '700', '799', '900', '999', '000'])('skips type %s', (code) => {
    expect(one(`16,${code},100,Z,,,X/`)).toEqual([]);
  });

  it('appends an 88 continuation with a space', () => {
    const out = parseBai2(bai2(file(['16,475,2530,Z,,,CARREFOUR/', '88,MULHOUSE/'])));
    expect(out[0]!.rawLabel).toBe('CARREFOUR MULHOUSE');
  });

  it('appends multiple 88 records', () => {
    const out = parseBai2(bai2(file(['16,475,2530,Z,,,A/', '88,B/', '88,C/', '88,D/'])));
    expect(out[0]!.rawLabel).toBe('A B C D');
  });

  it('joins a 16 line that runs past its line end', () => {
    const out = parseBai2(bai2(file(['16,475,2530,Z,,,PART ONE,', 'PART TWO/'])));
    expect(out[0]!.rawLabel).toBe('PART ONE,PART TWO');
  });

  it('does not attach 88 to a skipped record or the next one', () => {
    const out = parseBai2(bai2(file(['16,750,100,Z,,,SUM/', '88,EXTRA/', '16,301,100,Z,,,REAL/'])));
    expect(out.map((t) => t.rawLabel)).toEqual(['REAL']);
  });

  it('uses the bank reference as fitid', () => {
    expect(one('16,475,2530,Z,BANKREFXYZ,CUSTREF,X/')[0]!.fitid).toBe('BANKREFXYZ');
  });

  it('falls back to the customer reference', () => {
    expect(one('16,475,2530,Z,,CUSTREF,X/')[0]!.fitid).toBe('CUSTREF');
  });

  it('returns null fitid when both refs are empty', () => {
    expect(one('16,475,2530,Z,,,X/')[0]!.fitid).toBeNull();
  });

  it('treats NONREF and 0 as absent', () => {
    expect(one('16,475,2530,Z,NONREF,,X/')[0]!.fitid).toBeNull();
    expect(one('16,475,2530,Z,0,,X/')[0]!.fitid).toBeNull();
  });

  it('skips a non-numeric amount', () => {
    expect(one('16,475,ABC,Z,,,X/')).toEqual([]);
    expect(one('16,475,,Z,,,X/')).toEqual([]);
  });

  it('skips a record with too few fields', () => {
    expect(one('16,475,2530,Z/')).toEqual([]);
  });

  it('falls back to the type code when text is empty', () => {
    expect(one('16,475,2530,Z,,,/')[0]!.rawLabel).toBe('475');
  });

  it('keeps commas inside the text', () => {
    expect(one('16,475,2530,Z,,,A, B, C/')[0]!.rawLabel).toBe('A, B, C');
  });

  it('applies the century rule', () => {
    expect(one('16,301,100,Z,,,X/', '800101')[0]!.date).toBe('1980-01-01');
    expect(one('16,301,100,Z,,,X/', '790101')[0]!.date).toBe('2079-01-01');
  });

  it('converts cents to decimal', () => {
    expect(one('16,301,2530,Z,,,X/')[0]!.amount).toBe('25.30');
    expect(one('16,301,100000000,Z,,,X/')[0]!.amount).toBe('1000000.00');
  });

  it('assigns each group its own date', () => {
    const lines = [
      '01,S,R,260615,0800,1,80,1,2/',
      '02,R,S,1,260615,0800,USD,2/',
      '03,111,USD,010,0,,,/',
      '16,301,100,Z,,,A/',
      '49,0,2/',
      '98,0,1,4/',
      '02,R,S,1,260616,0800,USD,2/',
      '03,222,USD,010,0,,,/',
      '16,475,200,Z,,,B/',
      '49,0,2/',
      '98,0,1,4/',
      '99,0,2,8/',
    ];
    const out = parseBai2(bai2(lines));
    expect(out.map((t) => [t.date, t.rawLabel])).toEqual([
      ['2026-06-15', 'A'],
      ['2026-06-16', 'B'],
    ]);
  });

  it('preserves UTF-8 characters', () => {
    expect(one('16,475,2530,Z,,,CAFÉ DU COIN/')[0]!.rawLabel).toBe('CAFÉ DU COIN');
  });

  it('falls back to windows-1252 on invalid UTF-8', () => {
    const buf = Buffer.concat([
      Buffer.from('01,S,R,260615,0800,1,80,1,2/\n02,R,S,1,260615,0800,USD,2/\n16,475,100,Z,,,CAF', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('/\n99,0,1,3/\n', 'ascii'),
    ]);
    expect(parseBai2(buf)[0]!.rawLabel).toBe('CAFé');
  });

  it('returns [] when there are no 16 records', () => {
    expect(parseBai2(bai2(file([])))).toEqual([]);
  });

  it('throws when the 01 header is missing', () => {
    expect(() => parseBai2(Buffer.from('02,R,S,1,260615,0800,USD,2/\n'))).toThrow(
      'invalid BAI2 file: expected 01 header',
    );
  });

  it.each([['\r\n'], ['\n'], ['\r']])('tolerates line endings %j', (eol) => {
    const out = parseBai2(bai2(file(['16,475,2530,Z,,,X/', '88,Y/']), eol));
    expect(out).toHaveLength(1);
    expect(out[0]!.rawLabel).toBe('X Y');
  });
});
