import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { ParsedTransaction } from './ofx-parser.js';
import { parseFrenchDate, parseFrenchAmount } from './french-numerics.js';

// French banks export CSV with:
//   - separator ';'  (because the decimal is ',')
//   - decimal ','
//   - dates JJ/MM/AAAA
// Column names vary by bank. We try a list of common header names and require
// at least: a date column, a label column, and either a signed Montant column
// or a Débit + Crédit pair.

const DATE_HEADERS = ['date', 'date operation', 'date opération', 'date comptable', 'date valeur', 'date de l\'operation', "date de l'opération"];
const LABEL_HEADERS = ['libelle', 'libellé', 'libelle operation', 'libellé opération', 'description', 'details', 'détails', 'communication'];
const AMOUNT_HEADERS = ['montant', 'amount', 'mouvement'];
const DEBIT_HEADERS = ['debit', 'débit'];
const CREDIT_HEADERS = ['credit', 'crédit'];
const MEMO_HEADERS = ['notes', 'memo', 'commentaire', 'remarque'];

function strip(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function findHeader(headers: string[], candidates: string[]): string | null {
  const stripped = headers.map((h) => ({ raw: h, norm: strip(h) }));
  for (const c of candidates) {
    const cn = strip(c);
    const hit = stripped.find((h) => h.norm === cn);
    if (hit) return hit.raw;
  }
  return null;
}

function decodeBuffer(buf: Buffer): string {
  // Quickly sniff between UTF-8 and Windows-1252 by trying to decode as UTF-8
  // strictly; if it fails (mojibake characters), fall back.
  const utf8 = buf.toString('utf8');
  // Heuristic: if there's the replacement char or stray 0xC2 in places we
  // wouldn't expect, treat as latin1. Very crude but good enough.
  if (utf8.includes('�')) {
    return iconv.decode(buf, 'windows-1252');
  }
  return utf8;
}

export function parseFrenchCsv(buf: Buffer): ParsedTransaction[] {
  const text = decodeBuffer(buf);

  // Try ';' first (the French convention). If that yields a single column, retry with ','.
  let rows: Record<string, string>[];
  try {
    rows = parse(text, {
      delimiter: ';',
      columns: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    });
    if (!rows.length || Object.keys(rows[0]!).length < 2) throw new Error('too few columns');
  } catch {
    rows = parse(text, {
      delimiter: ',',
      columns: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    });
  }

  if (!rows.length) return [];

  const headers = Object.keys(rows[0]!);
  const dateCol = findHeader(headers, DATE_HEADERS);
  const labelCol = findHeader(headers, LABEL_HEADERS);
  const memoCol = findHeader(headers, MEMO_HEADERS);
  const amountCol = findHeader(headers, AMOUNT_HEADERS);
  const debitCol = findHeader(headers, DEBIT_HEADERS);
  const creditCol = findHeader(headers, CREDIT_HEADERS);

  if (!dateCol || !labelCol) {
    throw new Error(
      `CSV: missing required column. Found headers: ${headers.join(', ')}. Need a date column and a label column.`,
    );
  }
  if (!amountCol && !(debitCol || creditCol)) {
    throw new Error(
      `CSV: missing amount column. Need either "Montant" or a Débit/Crédit pair. Found: ${headers.join(', ')}`,
    );
  }

  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    const dateRaw = row[dateCol];
    const labelRaw = row[labelCol];
    if (!dateRaw || !labelRaw) continue;

    let amount: string;
    if (amountCol) {
      amount = parseFrenchAmount(row[amountCol] ?? '');
    } else {
      const d = debitCol ? row[debitCol] : '';
      const c = creditCol ? row[creditCol] : '';
      if (d && d.trim()) {
        const n = parseFrenchAmount(d);
        amount = n.startsWith('-') ? n : `-${n}`;
      } else if (c && c.trim()) {
        amount = parseFrenchAmount(c);
      } else {
        continue;
      }
    }

    out.push({
      date: parseFrenchDate(dateRaw),
      amount,
      rawLabel: labelRaw.trim(),
      memo: memoCol ? (row[memoCol]?.trim() || null) : null,
      fitid: null,
    });
  }

  return out;
}
