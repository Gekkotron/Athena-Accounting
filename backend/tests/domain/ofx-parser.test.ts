import { describe, it, expect } from 'vitest';
import { parseOfx, decodeOfxBuffer } from '../../src/domain/imports/ofx-parser.js';

function ofxBody(charset: 'UTF-8' | 'WINDOWS-1252', transactions: string): Buffer {
  const header = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    `CHARSET:${charset}`,
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '',
  ].join('\r\n');
  const body = `<OFX>${transactions}</OFX>`;
  return Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(body, 'latin1')]);
}

describe('decodeOfxBuffer', () => {
  it('respects the CHARSET:1252 header when decoding accented labels', () => {
    // "café" in Windows-1252 → é = 0xE9
    const header = 'OFXHEADER:100\r\nCHARSET:1252\r\n\r\n<OFX>';
    const buf = Buffer.concat([
      Buffer.from(header, 'latin1'),
      Buffer.from([0x63, 0x61, 0x66, 0xe9]),  // "café"
      Buffer.from('</OFX>', 'latin1'),
    ]);
    expect(decodeOfxBuffer(buf)).toContain('café');
  });

  it('defaults to UTF-8 when the CHARSET header is missing entirely', () => {
    // No CHARSET line → detectCharset returns 'utf-8'.
    const buf = Buffer.from('<OFX>hello</OFX>', 'utf-8');
    expect(decodeOfxBuffer(buf)).toContain('hello');
  });

  it('falls back to UTF-8 for an unrecognized CHARSET value', () => {
    // Unknown charset ("KOI8-R") — the parser silently defaults to UTF-8
    // rather than throwing, so imports of exotic exports keep working.
    const buf = Buffer.from('OFXHEADER:100\r\nCHARSET:KOI8-R\r\n\r\n<OFX>hi</OFX>', 'utf-8');
    expect(decodeOfxBuffer(buf)).toContain('hi');
  });

  it('accepts ISO-8859-1 as an alias for latin-1', () => {
    const buf = Buffer.concat([
      Buffer.from('OFXHEADER:100\r\nCHARSET:ISO-8859-1\r\n\r\n<OFX>', 'latin1'),
      Buffer.from([0xe9]), // é in latin-1
      Buffer.from('</OFX>', 'latin1'),
    ]);
    expect(decodeOfxBuffer(buf)).toContain('é');
  });
});

describe('parseOfx', () => {
  it('parses a well-formed SGML transaction', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <DTPOSTED>20260615000000
        <TRNAMT>-25.30
        <NAME>CARREFOUR
        <FITID>abc-123
      </STMTTRN>
    `);
    const rows = parseOfx(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-06-15',
      amount: '-25.30',
      rawLabel: 'CARREFOUR',
      memo: null,
      fitid: 'abc-123',
    });
  });

  it('joins NAME + MEMO into rawLabel when both are present', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <DTPOSTED>20260615
        <TRNAMT>-10.00
        <NAME>CB CARREFOUR
        <MEMO>MULHOUSE
      </STMTTRN>
    `);
    const rows = parseOfx(buf);
    expect(rows[0]!.rawLabel).toBe('CB CARREFOUR MULHOUSE');
    expect(rows[0]!.memo).toBe('MULHOUSE');
  });

  it('accepts a French comma decimal in TRNAMT', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <DTPOSTED>20260615
        <TRNAMT>-42,30
        <NAME>X
      </STMTTRN>
    `);
    expect(parseOfx(buf)[0]!.amount).toBe('-42.30');
  });

  it('skips STMTTRN blocks missing DTPOSTED or TRNAMT', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <NAME>NO DATE
      </STMTTRN>
      <STMTTRN>
        <DTPOSTED>20260615
        <NAME>NO AMOUNT
      </STMTTRN>
      <STMTTRN>
        <DTPOSTED>20260615
        <TRNAMT>1.00
        <NAME>OK
      </STMTTRN>
    `);
    const rows = parseOfx(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawLabel).toBe('OK');
  });

  it('throws when DTPOSTED has fewer than 8 digits', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <DTPOSTED>2026061
        <TRNAMT>1.00
        <NAME>X
      </STMTTRN>
    `);
    expect(() => parseOfx(buf)).toThrow(/invalid OFX date/);
  });

  it('throws when TRNAMT is not a valid decimal', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN>
        <DTPOSTED>20260615
        <TRNAMT>not-a-number
        <NAME>X
      </STMTTRN>
    `);
    expect(() => parseOfx(buf)).toThrow(/invalid OFX amount/);
  });

  it('parses multiple back-to-back STMTTRN blocks', () => {
    const buf = ofxBody('UTF-8', `
      <STMTTRN><DTPOSTED>20260615<TRNAMT>-1.00<NAME>A</STMTTRN>
      <STMTTRN><DTPOSTED>20260616<TRNAMT>2.50<NAME>B</STMTTRN>
      <STMTTRN><DTPOSTED>20260617<TRNAMT>-3.14<NAME>C<FITID>xyz</STMTTRN>
    `);
    const rows = parseOfx(buf);
    expect(rows.map((r) => r.rawLabel)).toEqual(['A', 'B', 'C']);
    expect(rows[2]!.fitid).toBe('xyz');
  });

  it('returns [] when the buffer has no STMTTRN blocks', () => {
    const buf = ofxBody('UTF-8', '<BANKMSGSRSV1></BANKMSGSRSV1>');
    expect(parseOfx(buf)).toEqual([]);
  });
});
