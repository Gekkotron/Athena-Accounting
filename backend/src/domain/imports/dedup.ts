import { createHash } from 'node:crypto';

export interface DedupInput {
  accountId: number;
  date: string;           // YYYY-MM-DD
  amount: string;         // signed decimal string e.g. "-25.30"
  normalizedLabel: string;
  fitid?: string | null;
}

// FITID is the bank-provided unique transaction id (when present in an OFX
// file). If the bank provides one we trust it — it survives label edits, time
// zones, etc. Otherwise we hash a tuple that's stable across re-imports.
//
// The hash is prefixed so we can tell at a glance how a row was deduped.
export function computeDedupKey(t: DedupInput): string {
  if (t.fitid && t.fitid.trim()) return `fitid:${t.fitid.trim()}`;
  const material = `${t.accountId}|${t.date}|${t.amount}|${t.normalizedLabel}`;
  return `hash:${createHash('sha1').update(material).digest('hex')}`;
}
