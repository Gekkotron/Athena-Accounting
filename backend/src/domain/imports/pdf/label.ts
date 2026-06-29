// OFX 2.0's NAME field is capped at 32 characters, so French banks truncate
// transaction labels mid-word ("CASTORAMA CARTE 7883 PAIEMENT MOB 0107 KINGERSH
// 1478/" becomes "CASTORAMA CARTE 7883 PAIEMENT MO" in the OFX export). PDF
// statements carry the full label across one or two lines. Mirroring the OFX
// cap on PDF rawLabels makes the dedup key collide cleanly between the two
// sources — without it, the same real-world transaction imported as both OFX
// and PDF would land twice.
export const OFX_NAME_LENGTH = 32;

export function truncateLabel(s: string, max = OFX_NAME_LENGTH): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd();
}

// French banks' OFX exports put the *merchant* in the NAME field. In their PDF
// statements, the line carrying the date+amount is often a bank-meta prefix
// (PAIEMENT CB ..., VIREMENT ..., etc.) and the merchant lives on the
// continuation row. Mirror the bank's choice: if the parent line starts with a
// recognized bank-prefix word, promote the continuation to lead the label.
// Otherwise the parent is already the merchant (e.g. "MAGASIN U", "CASTORAMA")
// and keeps the lead.
const BANK_PREFIX_RE = /^(paiement|paiment|vir(ement)?|prlv|prelvt|prelevement|cb|carte|retrait|dab|cheque|chq|tip|achat)\b/i;

// Rows whose description column starts with a balance keyword are statement
// markers ("Ancien solde / Solde créditeur au 01/07/2025 / Nouveau solde"),
// not transactions. They typically carry a date and an amount that look just
// like transaction data, so we have to filter them by label content. Skip the
// row entirely — don't create a transaction, don't treat as a continuation
// candidate, don't count toward the heuristic's confidence denominator.
const BALANCE_LINE_RE = /^\s*(nouveau\s+|ancien\s+|total\s+)?solde\b/i;
export function isBalanceLine(s: string): boolean {
  return BALANCE_LINE_RE.test(s);
}

export function mergeContinuationLabel(parent: string, continuation: string): string {
  if (!parent) return truncateLabel(continuation);
  if (!continuation) return truncateLabel(parent);
  const order = BANK_PREFIX_RE.test(parent)
    ? `${continuation} - ${parent}`
    : `${parent} - ${continuation}`;
  return truncateLabel(order);
}
