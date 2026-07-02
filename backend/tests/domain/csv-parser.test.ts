import { describe, it, expect } from 'vitest';
import { parseFrenchCsv } from '../../src/domain/imports/csv-parser.js';

const utf8 = (s: string) => Buffer.from(s, 'utf8');

describe('parseFrenchCsv', () => {
  it('parses a semicolon-separated statement with Montant column', () => {
    const csv = utf8([
      'Date;Libellé;Montant',
      '15/06/2026;CB CARREFOUR;-42,30',
      '16/06/2026;VIR SALAIRE;2500,00',
    ].join('\n'));
    const rows = parseFrenchCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-06-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' });
    expect(rows[1]).toMatchObject({ date: '2026-06-16', amount: '2500.00', rawLabel: 'VIR SALAIRE' });
  });

  it('accepts a Débit/Crédit pair instead of Montant', () => {
    const csv = utf8([
      'Date;Libellé;Débit;Crédit',
      '15/06/2026;CB CARREFOUR;42,30;',
      '16/06/2026;VIR SALAIRE;;2500,00',
    ].join('\n'));
    const rows = parseFrenchCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amount).toBe('-42.30');
    expect(rows[1]!.amount).toBe('2500.00');
  });

  it('handles headers case-insensitively and with/without accents', () => {
    const csv = utf8([
      'DATE OPERATION;LIBELLE;MONTANT',
      '15/06/2026;A;1,00',
    ].join('\n'));
    expect(parseFrenchCsv(csv)).toHaveLength(1);
  });

  it('reads a memo column when present', () => {
    const csv = utf8([
      'Date;Libellé;Montant;Notes',
      '15/06/2026;A;1,00;important',
    ].join('\n'));
    expect(parseFrenchCsv(csv)[0]!.memo).toBe('important');
  });

  it('falls back to comma-delimited when semicolon yields only one column', () => {
    // Whole-number amount avoids the French/US decimal-separator ambiguity
    // that comma-delimited files inherit.
    const csv = utf8([
      'Date,Libellé,Montant',
      '15/06/2026,A,42',
    ].join('\n'));
    const rows = parseFrenchCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('42.00');
  });

  it('skips rows missing either date or label', () => {
    const csv = utf8([
      'Date;Libellé;Montant',
      ';empty date;1,00',
      '15/06/2026;;2,00',
      '15/06/2026;OK;3,00',
    ].join('\n'));
    const rows = parseFrenchCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawLabel).toBe('OK');
  });

  it('throws when required columns are missing', () => {
    const csv = utf8('Foo;Bar\n1;2\n');
    expect(() => parseFrenchCsv(csv)).toThrow(/missing required column/i);
  });

  it('throws when there is no amount column at all', () => {
    const csv = utf8([
      'Date;Libellé',
      '15/06/2026;A',
    ].join('\n'));
    expect(() => parseFrenchCsv(csv)).toThrow(/missing amount column/i);
  });

  it('decodes Windows-1252 buffers with accented labels', () => {
    // "café" in cp1252: 63 61 66 e9
    const header = Buffer.from('Date;Libellé;Montant\n15/06/2026;', 'latin1');
    const label = Buffer.from([0x63, 0x61, 0x66, 0xe9]);  // "café"
    const rest = Buffer.from(';1,00\n', 'latin1');
    // Force replacement char in a UTF-8 decode by including a stray 0xe9.
    const buf = Buffer.concat([header, label, rest]);
    const rows = parseFrenchCsv(buf);
    // Even if the header parser gets confused by mojibake, the label should
    // contain "café" (windows-1252 decode branch fired).
    expect(rows[0]!.rawLabel).toContain('café');
  });

  it('returns [] for an empty (but non-throwing) input', () => {
    // csv-parse throws when there are no rows at all, so provide headers only.
    const csv = utf8('Date;Libellé;Montant\n');
    expect(parseFrenchCsv(csv)).toEqual([]);
  });
});
