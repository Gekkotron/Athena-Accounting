import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { decodeOfxBuffer, parseOfx } from '../ofx-parser.js';

const sgmlHeader = (charset = 'UTF-8') =>
  `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nENCODING:USASCII\r\nCHARSET:${charset}\r\n\r\n`;

const wrap = (trns: string) =>
  `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\r\n<DTSTART>20260601\r\n<DTEND>20260630\r\n${trns}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const buf = (s: string) => Buffer.from(s, 'utf-8');

describe('parseOfx', () => {
  it('parses SGML with unclosed field tags', () => {
    const text =
      sgmlHeader() +
      wrap(
        '<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20260627120000\r\n<TRNAMT>-25.30\r\n<FITID>F1\r\n<NAME>CARREFOUR\r\n<MEMO>CB 27/06\r\n</STMTTRN>\r\n',
      );
    expect(parseOfx(buf(text))).toEqual([
      { date: '2026-06-27', amount: '-25.30', rawLabel: 'CARREFOUR CB 27/06', memo: 'CB 27/06', fitid: 'F1' },
    ]);
  });

  it('parses the XML variant with closed tags', () => {
    const text =
      '<?xml version="1.0"?><OFX>' +
      '<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260105</DTPOSTED><TRNAMT>1500.00</TRNAMT><FITID>X9</FITID><NAME>SALAIRE</NAME></STMTTRN></OFX>';
    expect(parseOfx(buf(text))).toEqual([
      { date: '2026-01-05', amount: '1500.00', rawLabel: 'SALAIRE', memo: null, fitid: 'X9' },
    ]);
  });

  it.each([
    ['20260627', '2026-06-27'],
    ['20260627120000', '2026-06-27'],
    ['20260627120000.000', '2026-06-27'],
    ['20260627120000.000[-5:EST]', '2026-06-27'],
  ])('accepts DTPOSTED %s', (dt, expected) => {
    const text = wrap(`<STMTTRN><DTPOSTED>${dt}\n<TRNAMT>1\n<NAME>A\n</STMTTRN>`);
    expect(parseOfx(buf(text))[0]!.date).toBe(expected);
  });

  it('throws on an invalid date', () => {
    const text = wrap('<STMTTRN><DTPOSTED>2026-06-27\n<TRNAMT>1\n<NAME>A\n</STMTTRN>');
    expect(() => parseOfx(buf(text))).toThrow(/invalid OFX date/);
  });

  it('ignores DTSTART/DTEND outside transactions', () => {
    expect(parseOfx(buf(wrap('')))).toEqual([]);
  });

  it('accepts a comma decimal and normalizes to two decimals', () => {
    const text = wrap('<STMTTRN><DTPOSTED>20260101\n<TRNAMT>-12,5\n<NAME>A\n</STMTTRN>');
    expect(parseOfx(buf(text))[0]!.amount).toBe('-12.50');
  });

  it('throws on a non-numeric amount', () => {
    const text = wrap('<STMTTRN><DTPOSTED>20260101\n<TRNAMT>abc\n<NAME>A\n</STMTTRN>');
    expect(() => parseOfx(buf(text))).toThrow(/invalid OFX amount/);
  });

  it('skips blocks missing date or amount', () => {
    const text = wrap(
      '<STMTTRN><TRNAMT>1\n<NAME>A\n</STMTTRN><STMTTRN><DTPOSTED>20260101\n<NAME>B\n</STMTTRN><STMTTRN><DTPOSTED>20260102\n<TRNAMT>2\n<NAME>C\n</STMTTRN>',
    );
    const rows = parseOfx(buf(text));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawLabel).toBe('C');
  });

  it('does not reject unknown TRNTYPE values', () => {
    const text = wrap('<STMTTRN><TRNTYPE>WEIRD\n<DTPOSTED>20260101\n<TRNAMT>3\n<NAME>A\n</STMTTRN>');
    expect(parseOfx(buf(text))).toHaveLength(1);
  });

  it('falls back across NAME and MEMO for the label', () => {
    const onlyMemo = wrap('<STMTTRN><DTPOSTED>20260101\n<TRNAMT>3\n<MEMO>only memo\n</STMTTRN>');
    expect(parseOfx(buf(onlyMemo))[0]!.rawLabel).toBe('only memo');
    const neither = wrap('<STMTTRN><DTPOSTED>20260101\n<TRNAMT>3\n</STMTTRN>');
    expect(parseOfx(buf(neither))[0]!.rawLabel).toBe('');
  });

  it('matches tags case-insensitively', () => {
    const text = '<ofx><stmttrn><dtposted>20260101\n<trnamt>3\n<name>a\n</stmttrn></ofx>';
    expect(parseOfx(buf(text))).toHaveLength(1);
  });

  it('returns multiple transactions in order', () => {
    const text = wrap(
      '<STMTTRN><DTPOSTED>20260101\n<TRNAMT>1\n<NAME>A\n</STMTTRN><STMTTRN><DTPOSTED>20260102\n<TRNAMT>2\n<NAME>B\n</STMTTRN>',
    );
    expect(parseOfx(buf(text)).map((r) => r.rawLabel)).toEqual(['A', 'B']);
  });

  it('decodes Windows-1252 content declared by the header', () => {
    const text =
      sgmlHeader('1252') + wrap('<STMTTRN><DTPOSTED>20260101\n<TRNAMT>3\n<NAME>Café\n</STMTTRN>');
    const rows = parseOfx(iconv.encode(text, 'windows-1252'));
    expect(rows[0]!.rawLabel).toBe('Café');
  });
});

describe('decodeOfxBuffer', () => {
  it('defaults to utf-8 when no charset is declared', () => {
    expect(decodeOfxBuffer(Buffer.from('<OFX>é</OFX>', 'utf-8'))).toBe('<OFX>é</OFX>');
  });

  it('honours ISO-8859-1', () => {
    const text = 'CHARSET:ISO-8859-1\r\n\r\n<OFX>é</OFX>';
    expect(decodeOfxBuffer(iconv.encode(text, 'iso-8859-1'))).toContain('é');
  });

  it('falls back to utf-8 for unknown charsets', () => {
    const text = 'CHARSET:KLINGON\r\n\r\n<OFX>é</OFX>';
    expect(decodeOfxBuffer(Buffer.from(text, 'utf-8'))).toContain('é');
  });
});
