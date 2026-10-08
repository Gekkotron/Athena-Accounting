// BAI2 (Bank Administration Institute, US cash management) parser.
//
// Format decisions:
//   - Amounts: field 2 of a `16` record is an unsigned integer in cents
//     (`2530` -> `25.30`). The sign comes from the type code, not the amount.
//   - Type codes (field 1 of `16`):
//       100-399  credit  -> positive
//       400-699  debit   -> negative
//       700-799  control/summary totals -> skipped
//       900-999  non-monetary           -> skipped
//       anything else                   -> skipped
//   - Dates: `16` records carry no date. The date is the as-of-date (YYMMDD) in
//     field 5 of the enclosing `02` group header and applies to every `16`
//     until the next `02`. YY >= 80 is read as 19YY, else 20YY (same as MT940).
//   - fitid preference: bank reference (field 4) > customer reference
//     (field 5) > null. Empty, `0` and `NONREF` count as absent, so dedup falls
//     back to the (account, date, amount, label) hash.
//   - Label: text from field 6 onward (commas kept, trailing `/` stripped),
//     extended by `88` continuation records joined with a single space; falls
//     back to the type code when empty.
//   - A `16` line ending in `,` physically continues on the next line unless
//     that line starts a new record. `01`, `02`, `03`, `49`, `98`, `99` are
//     structure records; only `01` presence is validated.
//   - Decoded as UTF-8; on replacement chars, re-decoded as windows-1252.
import iconv from 'iconv-lite';
import type { ParsedTransaction } from './ofx-parser.js';

const RECORD_START = /^(01|02|03|16|49|88|98|99),/;
const YYMMDD = /^(\d{2})(\d{2})(\d{2})$/;
// `16`, type, amount, funds type, bank ref, customer ref: six commas precede the text.
const LEADING_COMMAS = 6;

interface PendingEntry {
  date: string;
  typeCode: number;
  typeRaw: string;
  cents: string;
  bankRef: string;
  customerRef: string;
  text: string;
}

function decode(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? iconv.decode(buf, 'windows-1252') : utf8;
}

function stripTerminator(s: string): string {
  return s.replace(/\/\s*$/, '');
}

// Joins `16` lines that run past their line end (trailing `,`) with the next
// line, unless that line begins a new record.
function logicalLines(text: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    if (open && !RECORD_START.test(line)) {
      out[out.length - 1] += line;
    } else {
      out.push(line);
    }
    const last = out[out.length - 1]!;
    open = last.startsWith('16,') && last.endsWith(',');
  }
  return out;
}

function groupDate(line: string): string | null {
  const m = (line.split(',')[4] ?? '').trim().match(YYMMDD);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${Number(yy) >= 80 ? '19' : '20'}${yy}-${mm}-${dd}`;
}

function parseDetail(line: string, date: string | null): PendingEntry | null {
  if (!date) return null;
  const body = stripTerminator(line);
  const fields: string[] = [];
  let rest = body;
  for (let i = 0; i < LEADING_COMMAS; i++) {
    const idx = rest.indexOf(',');
    if (idx < 0) return null;
    fields.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  const typeRaw = fields[1]!.trim();
  const cents = fields[2]!.trim();
  if (!/^\d{3}$/.test(typeRaw) || !/^\d+$/.test(cents)) return null;
  return {
    date,
    typeCode: Number(typeRaw),
    typeRaw,
    cents,
    bankRef: fields[4]!.trim(),
    customerRef: fields[5]!.trim(),
    text: rest.trim(),
  };
}

function pickReference(...refs: string[]): string | null {
  for (const ref of refs) {
    if (ref && ref !== '0' && ref.toUpperCase() !== 'NONREF') return ref;
  }
  return null;
}

function toTransaction(entry: PendingEntry): ParsedTransaction | null {
  const credit = entry.typeCode >= 100 && entry.typeCode <= 399;
  const debit = entry.typeCode >= 400 && entry.typeCode <= 699;
  if (!credit && !debit) return null;
  const magnitude = (Number(entry.cents) / 100).toFixed(2);
  const amount = debit && Number(magnitude) !== 0 ? `-${magnitude}` : magnitude;
  return {
    date: entry.date,
    amount,
    rawLabel: entry.text.replace(/\s+/g, ' ').trim() || entry.typeRaw,
    memo: null,
    fitid: pickReference(entry.bankRef, entry.customerRef),
  };
}

export function parseBai2(buf: Buffer): ParsedTransaction[] {
  const lines = logicalLines(decode(buf));
  if (!lines[0]?.startsWith('01,')) {
    throw new Error('invalid BAI2 file: expected 01 header');
  }

  const out: ParsedTransaction[] = [];
  let date: string | null = null;
  let current: PendingEntry | null = null;

  const flush = () => {
    const tx = current ? toTransaction(current) : null;
    if (tx) out.push(tx);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('88,')) {
      if (current) {
        const extra = stripTerminator(line.slice(3)).trim();
        current.text = `${current.text} ${extra}`.trim();
      }
      continue;
    }
    flush();
    if (line.startsWith('02,')) {
      date = groupDate(line);
    } else if (line.startsWith('16,')) {
      current = parseDetail(line, date);
    }
  }
  flush();
  return out;
}
