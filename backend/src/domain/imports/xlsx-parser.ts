import ExcelJS from 'exceljs';
import type { ParsedTransaction } from './ofx-parser.js';
import { parseFrenchDate, parseAmountAuto } from './french-numerics.js';
import {
  DATE_HEADERS,
  LABEL_HEADERS,
  AMOUNT_HEADERS,
  DEBIT_HEADERS,
  CREDIT_HEADERS,
  MEMO_HEADERS,
  strip,
  findHeader,
} from './csv-parser.js';

// Excel (.xlsx) statement parser.
//
// Library: exceljs (MIT, actively maintained) rather than SheetJS, whose
// community edition is only dumped once a year. exceljs is async-only, so
// parseXlsx returns a Promise unlike the other parsers.
//
// Header detection reuses the CSV header vocabularies and accent-stripping
// matcher. Bank exports often have preamble rows, so the first 20 rows are
// scanned for one that has a date header plus a label/amount/debit/credit
// header; data starts on the following row.
//
// Dates: ExcelJS yields Date objects for date-formatted cells, numbers for
// raw serials, or strings. Serials are converted from the 1899-12-30 epoch,
// which absorbs the Lotus 1900 leap-year bug for any date after 1900-03-01.

const HEADER_SCAN_ROWS = 20;
const MS_PER_DAY = 86400000;

function cellToPrimitive(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) return v;
  if (typeof v === 'boolean') return null;
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) {
      return cellToPrimitive(v.result as ExcelJS.CellValue);
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
  }
  return null;
}

function rowValues(row: ExcelJS.Row, width: number): (string | number | Date | null)[] {
  const out: (string | number | Date | null)[] = [];
  for (let c = 1; c <= width; c++) out.push(cellToPrimitive(row.getCell(c).value));
  return out;
}

function isBlank(v: string | number | Date | null): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

function formatUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDate(v: string | number | Date | null): string | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) return formatUtc(v);
  if (typeof v === 'number') return formatUtc(new Date(Date.UTC(1899, 11, 30) + v * MS_PER_DAY));
  return parseFrenchDate(String(v));
}

function toAmount(v: string | number | Date | null): string | null {
  if (isBlank(v) || v instanceof Date) return null;
  if (typeof v === 'number') return v.toFixed(2);
  return parseAmountAuto(String(v));
}

function toText(v: string | number | Date | null): string {
  if (isBlank(v)) return '';
  if (v instanceof Date) return formatUtc(v);
  return String(v).trim();
}

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    return wb;
  } catch (err) {
    // exceljs only ships an xlsx reader; legacy binary .xls cannot be loaded.
    throw new Error(`invalid Excel file: ${(err as Error).message}`);
  }
}

function matchesHeaderRow(cells: string[]): boolean {
  const hasDate = findHeader(cells, DATE_HEADERS) !== null;
  if (!hasDate) return false;
  return (
    findHeader(cells, LABEL_HEADERS) !== null ||
    findHeader(cells, AMOUNT_HEADERS) !== null ||
    findHeader(cells, DEBIT_HEADERS) !== null ||
    findHeader(cells, CREDIT_HEADERS) !== null
  );
}

export async function parseXlsx(buf: Buffer): Promise<ParsedTransaction[]> {
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) return [];

  const width = ws.columnCount;
  let headerRowNum = -1;
  let headers: string[] = [];
  const firstRows: string[][] = [];
  const scanTo = Math.min(HEADER_SCAN_ROWS, ws.rowCount);
  for (let r = 1; r <= scanTo; r++) {
    const cells = rowValues(ws.getRow(r), width).map((v) => toText(v));
    firstRows.push(cells);
    if (matchesHeaderRow(cells)) {
      headerRowNum = r;
      headers = cells;
      break;
    }
  }

  if (headerRowNum < 0) {
    const found = firstRows.find((c) => c.some((x) => strip(x) !== '')) ?? [];
    throw new Error(
      `Excel: missing required column. Need a date column and a label column. Found headers: ${found.filter((x) => x !== '').join(', ')}`,
    );
  }

  const dateCol = findHeader(headers, DATE_HEADERS);
  const labelCol = findHeader(headers, LABEL_HEADERS);
  const amountCol = findHeader(headers, AMOUNT_HEADERS);
  const debitCol = findHeader(headers, DEBIT_HEADERS);
  const creditCol = findHeader(headers, CREDIT_HEADERS);
  const memoCol = findHeader(headers, MEMO_HEADERS);

  if (!dateCol || !labelCol) {
    throw new Error(
      `Excel: missing required column. Need a date column and a label column. Found headers: ${headers.filter((x) => x !== '').join(', ')}`,
    );
  }
  if (!amountCol && !(debitCol || creditCol)) {
    throw new Error(
      `Excel: missing amount column. Need either "Montant" or a Débit/Crédit pair. Found: ${headers.filter((x) => x !== '').join(', ')}`,
    );
  }

  const idx = (name: string | null): number => (name === null ? -1 : headers.indexOf(name));
  const dateIdx = idx(dateCol);
  const labelIdx = idx(labelCol);
  const amountIdx = idx(amountCol);
  const debitIdx = idx(debitCol);
  const creditIdx = idx(creditCol);
  const memoIdx = idx(memoCol);

  const out: ParsedTransaction[] = [];
  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const vals = rowValues(ws.getRow(r), width);
    const date = toDate(vals[dateIdx] ?? null);
    const label = toText(vals[labelIdx] ?? null);
    if (!date || !label) continue;

    let amount: string | null;
    if (amountIdx >= 0) {
      amount = toAmount(vals[amountIdx] ?? null);
    } else {
      const d = debitIdx >= 0 ? toAmount(vals[debitIdx] ?? null) : null;
      const c = creditIdx >= 0 ? toAmount(vals[creditIdx] ?? null) : null;
      if (d !== null) amount = d.startsWith('-') ? d : `-${d}`;
      else amount = c;
    }
    if (amount === null) continue;

    out.push({
      date,
      amount,
      rawLabel: label,
      memo: memoIdx >= 0 ? toText(vals[memoIdx] ?? null) || null : null,
      fitid: null,
    });
  }
  return out;
}
