import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { parseFrenchCsv } from '../csv-parser.js';

const b = (s: string) => Buffer.from(s, 'utf-8');

describe('parseFrenchCsv', () => {
  it('parses a semicolon file with French dates and decimals', () => {
    const csv = 'Date;Libellé;Montant\n27/06/2026;CARREFOUR;-1 234,56\n28/06/2026;SALAIRE;2 000,00\n';
    expect(parseFrenchCsv(b(csv))).toEqual([
      { date: '2026-06-27', amount: '-1234.56', rawLabel: 'CARREFOUR', memo: null, fitid: null },
      { date: '2026-06-28', amount: '2000.00', rawLabel: 'SALAIRE', memo: null, fitid: null },
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    const csv = '﻿Date;Libellé;Montant\n01/02/2026;A;1,5\n';
    expect(parseFrenchCsv(b(csv))).toHaveLength(1);
  });

  it.each([['\r\n'], ['\n']])('handles uniform line ending %j', (eol) => {
    const csv = ['Date;Libellé;Montant', '01/02/2026;A;1,00', '02/02/2026;B;2,00', ''].join(eol);
    expect(parseFrenchCsv(b(csv)).map((r) => r.rawLabel)).toEqual(['A', 'B']);
  });

  it('currently rejects files mixing CRLF and LF (record delimiter is sniffed from the first line)', () => {
    const csv = 'Date;Libellé;Montant\r\n01/02/2026;A;1,00\n02/02/2026;B;2,00\r\n';
    expect(() => parseFrenchCsv(b(csv))).toThrow(/invalid amount/);
  });

  it('handles quoted fields containing the delimiter and escaped quotes', () => {
    const csv = 'Date;Libellé;Montant\n01/02/2026;"ACME; SARL ""bis""";-3,00\n';
    expect(parseFrenchCsv(b(csv))[0]!.rawLabel).toBe('ACME; SARL "bis"');
  });

  it('falls back to comma delimiter with period decimals', () => {
    const csv = 'Date,Description,Amount\n01/02/2026,Coffee,-950.00\n02/02/2026,Pay,"1,234.56"\n';
    expect(parseFrenchCsv(b(csv)).map((r) => r.amount)).toEqual(['-950.00', '1234.56']);
  });

  it('matches headers case- and accent-insensitively', () => {
    const csv = 'DATE OPÉRATION;LIBELLE;MONTANT\n01/02/2026;A;1,00\n';
    expect(parseFrenchCsv(b(csv))).toHaveLength(1);
  });

  it('reads the memo column when present, null when empty', () => {
    const csv = 'Date;Libellé;Montant;Notes\n01/02/2026;A;1,00;hello\n02/02/2026;B;2,00;\n';
    expect(parseFrenchCsv(b(csv)).map((r) => r.memo)).toEqual(['hello', null]);
  });

  it('builds amounts from Débit/Crédit pairs', () => {
    const csv = 'Date;Libellé;Débit;Crédit\n01/02/2026;A;12,50;\n02/02/2026;B;;100,00\n03/02/2026;C;-4,00;\n04/02/2026;D;;\n';
    expect(parseFrenchCsv(b(csv)).map((r) => r.amount)).toEqual(['-12.50', '100.00', '-4.00']);
  });

  it('skips rows with empty date or label and blank lines', () => {
    const csv = 'Date;Libellé;Montant\n\n;A;1,00\n01/02/2026;;1,00\n02/02/2026;OK;1,00\n';
    expect(parseFrenchCsv(b(csv)).map((r) => r.rawLabel)).toEqual(['OK']);
  });

  it('tolerates short rows (relaxed column count)', () => {
    const csv = 'Date;Libellé;Montant;Notes\n01/02/2026;A;1,00\n';
    expect(parseFrenchCsv(b(csv))[0]!.memo).toBeNull();
  });

  it('returns an empty list for a header-only file', () => {
    expect(parseFrenchCsv(b('Date;Libellé;Montant\n'))).toEqual([]);
  });

  it('throws when date or label column is missing', () => {
    expect(() => parseFrenchCsv(b('Foo;Bar;Montant\n1;2;3\n'))).toThrow(/missing required column/);
  });

  it('throws when no amount column exists', () => {
    expect(() => parseFrenchCsv(b('Date;Libellé;Foo\n01/02/2026;A;1\n'))).toThrow(/missing amount column/);
  });

  it('throws on an invalid date or amount value', () => {
    expect(() => parseFrenchCsv(b('Date;Libellé;Montant\nbad;A;1,00\n'))).toThrow(/invalid French date/);
    expect(() => parseFrenchCsv(b('Date;Libellé;Montant\n01/02/2026;A;xyz\n'))).toThrow(/invalid amount/);
  });

  it('decodes Windows-1252 files', () => {
    const csv = 'Date;Libellé;Montant\n01/02/2026;Café;1,00\n';
    const rows = parseFrenchCsv(iconv.encode(csv, 'windows-1252'));
    expect(rows[0]!.rawLabel).toBe('Café');
  });

  it('trims whitespace around fields', () => {
    const csv = 'Date;Libellé;Montant\n 01/02/2026 ;  Spaced  ; 1,00 \n';
    expect(parseFrenchCsv(b(csv))[0]).toMatchObject({ date: '2026-02-01', rawLabel: 'Spaced', amount: '1.00' });
  });
});
