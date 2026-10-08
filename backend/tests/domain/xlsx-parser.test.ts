import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseXlsx } from '../../src/domain/imports/xlsx-parser.js';

async function buildXlsx(headers: string[], rows: unknown[][], preamble: unknown[][] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const p of preamble) ws.addRow(p);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function serial(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

describe('parseXlsx', () => {
  it('parses Date object + number amount', async () => {
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant'], [[new Date(Date.UTC(2026, 5, 15)), 'CARTE CARREFOUR', -25.3]]);
    expect(await parseXlsx(buf)).toEqual([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARTE CARREFOUR', memo: null, fitid: null },
    ]);
  });

  it('handles debit/credit columns', async () => {
    const buf = await buildXlsx(
      ['Date', 'Libellé', 'Débit', 'Crédit'],
      [
        [new Date(Date.UTC(2026, 5, 15)), 'ACHAT', 12.5, null],
        [new Date(Date.UTC(2026, 5, 16)), 'SALAIRE', null, 1000],
        [new Date(Date.UTC(2026, 5, 17)), 'VIDE', null, null],
      ],
    );
    const out = await parseXlsx(buf);
    expect(out.map((t) => t.amount)).toEqual(['-12.50', '1000.00']);
  });

  it('matches EN headers', async () => {
    const buf = await buildXlsx(['Date', 'Description', 'Amount'], [[new Date(Date.UTC(2026, 0, 2)), 'Coffee', -3]]);
    const out = await parseXlsx(buf);
    expect(out[0]).toMatchObject({ date: '2026-01-02', amount: '-3.00', rawLabel: 'Coffee' });
  });

  it('converts Excel serial dates', async () => {
    const s = serial(2026, 6, 15);
    expect(s).toBe(46188);
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant'], [[s, 'X', 1]]);
    expect((await parseXlsx(buf))[0]!.date).toBe('2026-06-15');
  });

  it('parses string dates', async () => {
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant'], [['15/06/2026', 'X', 1]]);
    expect((await parseXlsx(buf))[0]!.date).toBe('2026-06-15');
  });

  it('parses string amount with comma', async () => {
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant'], [['15/06/2026', 'X', '-25,30']]);
    expect((await parseXlsx(buf))[0]!.amount).toBe('-25.30');
  });

  it('skips rows with blank date or label', async () => {
    const buf = await buildXlsx(
      ['Date', 'Libellé', 'Montant'],
      [
        [null, 'NO DATE', 1],
        ['15/06/2026', null, 2],
        ['16/06/2026', 'OK', 3],
      ],
    );
    const out = await parseXlsx(buf);
    expect(out).toHaveLength(1);
    expect(out[0]!.rawLabel).toBe('OK');
  });

  it('keeps row order', async () => {
    const buf = await buildXlsx(
      ['Date', 'Libellé', 'Montant'],
      [
        ['01/06/2026', 'A', 1],
        ['02/06/2026', 'B', 2],
        ['03/06/2026', 'C', 3],
      ],
    );
    expect((await parseXlsx(buf)).map((t) => t.rawLabel)).toEqual(['A', 'B', 'C']);
  });

  it('detects headers after preamble rows', async () => {
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant'], [['15/06/2026', 'X', 1]], [
      ['Relevé de compte'],
      ['Titulaire: Jean'],
      [],
    ]);
    const out = await parseXlsx(buf);
    expect(out).toHaveLength(1);
    expect(out[0]!.rawLabel).toBe('X');
  });

  it('throws when headers are missing', async () => {
    const buf = await buildXlsx(['Foo', 'Bar'], [['a', 'b']]);
    await expect(parseXlsx(buf)).rejects.toThrow(/Excel: missing required column\. Need a date column and a label column\. Found headers: Foo, Bar/);
  });

  it('reads memo column when present', async () => {
    const buf = await buildXlsx(['Date', 'Libellé', 'Montant', 'Memo'], [['15/06/2026', 'X', 1, 'note']]);
    expect((await parseXlsx(buf))[0]!.memo).toBe('note');
  });

  it('returns [] for an empty worksheet', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    expect(await parseXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual([]);
  });

  it('uses the first worksheet with rows', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Date', 'Libellé', 'Montant']);
    ws.addRow(['15/06/2026', 'X', 1]);
    const out = await parseXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(out).toHaveLength(1);
  });

  it('rejects non-Excel input', async () => {
    await expect(parseXlsx(Buffer.from('not excel'))).rejects.toThrow(/invalid Excel file/);
  });
});
