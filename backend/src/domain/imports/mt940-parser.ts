// MT940 (SWIFT customer statement) parser.
//
// Format decisions:
//   - Dates: `:61:` carries a 2-digit year. YY >= 80 is read as 19YY, else
//     20YY. The optional entry date (MMDD) is skipped: the value date is what
//     matters for reconciliation, so ParsedTransaction.date is the value date.
//   - fitid preference: bank reference (after `//`) > customer reference >
//     null. `NONREF` is the SWIFT placeholder for "no reference" and counts
//     as absent, so dedup falls back to the (account, date, amount, label) hash.
//   - Label: `:86:` narrative, else the supplement lines trailing `:61:`, else
//     the `N`+type code (e.g. NTRF). The `:86:` structured subfields
//     (`?20?...?32?...`) are not parsed: the `?NN?` markers are stripped and
//     the pieces joined with a space, which reads fine for humans.
//   - A `:86:` only attaches to the `:61:` directly preceding it. Any other
//     tag (e.g. `:62F:`) or a `-` trailer closes that transaction, so a
//     statement-level `:86:` is ignored.
//   - Multiple messages in one file are parsed and concatenated.
//   - Decoded as UTF-8; on replacement chars, re-decoded as windows-1252.
import iconv from 'iconv-lite';
import type { ParsedTransaction } from './ofx-parser.js';

const TAG_LINE = /^:(\d{2}[A-Z]?):(.*)$/;
const TRAILER = /^-\}?$/;
const STATEMENT_LINE =
  /^(\d{2})(\d{2})(\d{2})(?:\d{4})?(RD|RC|D|C)[A-Z]?(\d+(?:,\d*)?)N([A-Z0-9]{3})([^/]*)(?:\/\/(.*))?$/;

interface RawEntry {
  statement: string;
  supplement: string[];
  narrative: string[] | null;
}

function decode(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? iconv.decode(buf, 'windows-1252') : utf8;
}

function collectEntries(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  // Which field the continuation lines currently belong to.
  let target: 'supplement' | 'narrative' | null = null;

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trimEnd();
    if (TRAILER.test(line)) {
      current = null;
      target = null;
      continue;
    }
    const tag = line.match(TAG_LINE);
    if (tag) {
      if (tag[1] === '61') {
        current = { statement: tag[2]!.trim(), supplement: [], narrative: null };
        entries.push(current);
        target = 'supplement';
      } else if (tag[1] === '86' && current && !current.narrative) {
        current.narrative = [tag[2]!];
        target = 'narrative';
      } else {
        current = null;
        target = null;
      }
      continue;
    }
    if (!current || !target || !line.trim()) continue;
    if (target === 'supplement') current.supplement.push(line.trim());
    else current.narrative!.push(line);
  }
  return entries;
}

function cleanNarrative(lines: string[]): string {
  const joined = lines.join(' ');
  const stripped = /\?\d{2}/.test(joined) ? joined.replace(/\?\d{2}\??/g, ' ') : joined;
  return stripped.replace(/\s+/g, ' ').trim();
}

function pickReference(customer: string, bank: string | undefined): string | null {
  for (const ref of [bank, customer]) {
    const trimmed = (ref ?? '').trim();
    if (trimmed && trimmed.toUpperCase() !== 'NONREF') return trimmed;
  }
  return null;
}

function toTransaction(entry: RawEntry): ParsedTransaction {
  const m = entry.statement.match(STATEMENT_LINE);
  if (!m) throw new Error(`invalid MT940 statement line: ${JSON.stringify(entry.statement)}`);
  const [, yy, mm, dd, mark, rawAmount, typeCode, customerRef, bankRef] = m;

  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`invalid MT940 statement line: ${JSON.stringify(entry.statement)}`);
  }
  const year = (Number(yy) >= 80 ? '19' : '20') + yy;

  const magnitude = Number(rawAmount!.replace(',', '.')).toFixed(2);
  const negative = mark === 'D' || mark === 'RC';
  const amount = negative && Number(magnitude) !== 0 ? `-${magnitude}` : magnitude;

  const narrative = entry.narrative ? cleanNarrative(entry.narrative) : '';
  const supplement = entry.supplement.join(' ').replace(/\s+/g, ' ').trim();
  const rawLabel = narrative || supplement || `N${typeCode}`;

  return {
    date: `${year}-${mm}-${dd}`,
    amount,
    rawLabel,
    memo: null,
    fitid: pickReference(customerRef!, bankRef),
  };
}

export function parseMt940(buf: Buffer): ParsedTransaction[] {
  return collectEntries(decode(buf)).map(toTransaction);
}
