// QIF (Quicken Interchange Format) parser.
//
// Format decisions:
//   - Line-based; the first character of each line is the field code and a
//     lone `^` ends a transaction. \r\n, \n and bare \r are all accepted.
//   - Decoded as latin1 (QIF is ASCII or a legacy 8-bit charset).
//   - Only `!Type:Bank`, `CCard`, `Cash`, `Oth A` and `Oth L` sections yield
//     transactions. Any other `!` header (Cat, Class, Memorized, Invst,
//     !Account, ...) disables parsing until the next supported header.
//   - Dates: `MM/DD/YYYY` is the historical default. If the first number is
//     > 12 it must be the day (`DD/MM/YYYY`); if only the second is > 12 it is
//     the day of a `MM/DD` date. Fully ambiguous dates resolve to `MM/DD`.
//     The Quicken apostrophe form (`MM/DD'YY`) means the year 2000+YY.
//     A 2-digit year without apostrophe pivots at 70 (>=70 -> 19xx).
//   - Amounts reuse parseAmountAuto (handles `-25,30` and `-1,234.56`).
//   - Splits (`S`, `E`, `$`), check numbers (`N`) and all other fields are
//     ignored; the top-level `T` amount is used.
//   - QIF has no unique transaction id, so fitid is always null and dedup
//     falls back to the (account, date, amount, label) hash.
//   - Transactions lacking `D` or `T` are skipped silently.
import type { ParsedTransaction } from './ofx-parser.js';
import { parseAmountAuto } from './french-numerics.js';

const SUPPORTED_TYPES = new Set(['bank', 'ccard', 'cash', 'oth a', 'oth l']);

function parseQifDate(raw: string): string {
  const s = raw.replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:(')|[/.-])(\d{2}|\d{4})$/);
  if (!m) throw new Error(`invalid QIF date: ${JSON.stringify(raw)}`);
  const a = Number(m[1]);
  const b = Number(m[2]);
  const apostrophe = m[3] === "'";
  let year = m[4]!;
  if (year.length === 2) {
    year = (apostrophe || Number(year) < 70 ? '20' : '19') + year;
  }
  let month = a;
  let day = b;
  if (a > 12) {
    day = a;
    month = b;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`invalid QIF date: ${JSON.stringify(raw)}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseQifAmount(raw: string): string {
  try {
    return parseAmountAuto(raw.trim().replace(/^\+/, ''));
  } catch {
    throw new Error(`invalid QIF amount: ${JSON.stringify(raw)}`);
  }
}

export function parseQif(buf: Buffer): ParsedTransaction[] {
  const text = buf.toString('latin1').replace(/^ï»¿/, '');
  const lines = text.split(/\r\n|\n|\r/);
  const out: ParsedTransaction[] = [];

  let supported = false;
  let date: string | null = null;
  let amount: string | null = null;
  let payee = '';
  let memo: string | null = null;

  const reset = () => {
    date = null;
    amount = null;
    payee = '';
    memo = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('!')) {
      const m = line.match(/^!Type:\s*(.*)$/i);
      supported = !!m && SUPPORTED_TYPES.has(m[1]!.trim().toLowerCase());
      reset();
      continue;
    }
    if (!supported) continue;

    if (line === '^') {
      if (date !== null && amount !== null) {
        out.push({
          date: parseQifDate(date),
          amount: parseQifAmount(amount),
          rawLabel: payee,
          memo,
          fitid: null,
        });
      }
      reset();
      continue;
    }

    const value = line.slice(1);
    switch (line[0]) {
      case 'D': date = value; break;
      case 'T': amount = value; break;
      case 'P': payee = value.trim(); break;
      case 'M': memo = value.trim() || null; break;
      default: break;
    }
  }

  return out.filter((t) => t.amount !== '');
}
