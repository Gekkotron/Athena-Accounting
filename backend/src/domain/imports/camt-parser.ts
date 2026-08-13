import type { ParsedTransaction } from './ofx-parser.js';

// ISO 20022 bank-to-customer statements. CAMT.053 = end-of-day statement,
// CAMT.052 = intraday report. Same <Ntry> shape in both; the only difference
// is the wrapper (BkToCstmrStmt/Stmt vs BkToCstmrAcctRpt/Rpt), which this
// parser doesn't need to distinguish — iterating <Ntry> blocks covers both.
// Sign convention matches bank-sync-core.ts: the indicator carries the
// direction, applied to the magnitude so a pre-signed DBIT never flips
// positive.

const CAMT_NS_RE = /urn:iso:std:iso:20022:tech:xsd:camt\.05[23]\./;

export function parseCamt(buf: Buffer): ParsedTransaction[] {
  const raw = buf.toString('utf-8');
  if (!CAMT_NS_RE.test(raw)) {
    throw new Error('unsupported XML: not a CAMT.053/052 document');
  }
  // Strip namespace prefixes on element names so a bank emitting
  // <ns2:Ntry> reaches the same extraction as one emitting <Ntry>. Only tag
  // names are touched; xmlns=/xmlns: attributes and text content are untouched.
  const xml = raw.replace(/<(\/?)[\w.-]+:/g, '<$1');

  const out: ParsedTransaction[] = [];
  const blocks = xml.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g);
  for (const m of blocks) {
    const row = parseEntry(m[1] ?? '');
    if (row) out.push(row);
  }
  return out;
}

function parseEntry(block: string): ParsedTransaction | null {
  // Only booked entries land in the ledger; PDNG rows change amount, date,
  // or vanish entirely before booking. Missing <Sts> is treated as BOOK
  // because some banks omit the tag on statements that are booked by nature.
  const sts = extractTag(block, 'Sts');
  if (sts && sts !== 'BOOK') return null;

  const amtRaw = extractTag(block, 'Amt');
  const cdi = extractTag(block, 'CdtDbtInd');
  if (!amtRaw || !cdi) return null;
  const rawNum = Number(amtRaw);
  if (!Number.isFinite(rawNum)) return null;
  const magnitude = Math.abs(rawNum);
  const signed = cdi === 'DBIT' ? -magnitude : cdi === 'CRDT' ? magnitude : rawNum;

  const bookDt =
    extractTagInParent(block, 'BookgDt', 'Dt') ??
    extractTagInParent(block, 'BookgDt', 'DtTm');
  const valDt =
    extractTagInParent(block, 'ValDt', 'Dt') ??
    extractTagInParent(block, 'ValDt', 'DtTm');
  const rawDate = bookDt ?? valDt;
  if (!rawDate) return null;
  const date = rawDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const ustrdFragments = [...block.matchAll(/<Ustrd>([^<]*)<\/Ustrd>/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter((s) => s.length > 0);
  const remittance = ustrdFragments.join(' ');
  // The counterparty is whoever is on the other side of the movement: on a
  // DBIT (money leaving) it's the creditor; on a CRDT (money arriving) it's
  // the debtor.
  const counterparty =
    cdi === 'DBIT'
      ? extractTagInParent(block, 'Cdtr', 'Nm')
      : extractTagInParent(block, 'Dbtr', 'Nm');
  const rawLabel = firstNonEmpty(remittance, counterparty) ?? 'Transaction';
  const memo = counterparty && counterparty !== rawLabel ? counterparty : null;

  const fitid =
    extractTag(block, 'AcctSvcrRef') ??
    extractTag(block, 'EndToEndId') ??
    extractTag(block, 'NtryRef');

  return {
    date,
    amount: signed.toFixed(2),
    rawLabel,
    memo,
    fitid,
  };
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`);
  const m = xml.match(re);
  if (!m) return null;
  const v = (m[1] ?? '').trim();
  return v || null;
}

function extractTagInParent(xml: string, parent: string, child: string): string | null {
  const parentRe = new RegExp(`<${parent}(?:\\s[^>]*)?>([\\s\\S]*?)</${parent}>`);
  const parentM = xml.match(parentRe);
  if (!parentM) return null;
  return extractTag(parentM[1] ?? '', child);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}
