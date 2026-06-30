// Bank statement labels arrive cluttered: card prefixes, posting dates,
// truncated card numbers, reference numbers. The "Tri des catégories" tab
// groups by *normalized* label so "CB CARREFOUR 27/06" and "PAIEMENT CARTE
// CARREFOUR 1234" both fall into the same bucket. This function defines the
// canonical normalization used both at import time (stored in
// transactions.normalized_label) and as the grouping key downstream.

// VIR INST and VIR SEPA are the same transfer with a different bank-side
// label; collapse the modifier so both normalize to the same string.
// Otherwise "VIR INST 12345 REF" and "VIR SEPA 12345 REF" stay distinct after
// normalization and dodge the strict dedup constraint, only to resurface in
// the soft-dedup panel for every dual-logged transfer.
const PREFIX_RE =
  /^(cb|carte|paiement|paiment|achat|vir(ement)?(\s+(inst(antan[eé])?|sepa))?|prlv|prelvt|prelevement|cheque|chq|tip|retrait|dab)\s+/i;

// dd, dd/mm, dd/mm/yy, dd/mm/yyyy with / . or - as separators
const DATE_RE = /\b\d{1,2}([\/.\-]\d{1,2}([\/.\-]\d{2,4})?)?\b/g;

// runs of 6+ digits — card numbers, reference IDs, etc.
const LONG_DIGITS_RE = /\b\d{6,}\b/g;

// Standalone short numerics often act as reference codes (truncated IBAN, etc.)
// Keep small numbers (1-5 digits) because they may carry meaning (amount, date day).
// Wait — small numbers like "27" from a date already removed. So strip 3-5 digit
// standalone numbers conservatively only when surrounded by spaces.
const ORPHAN_NUM_RE = /\s\d{3,5}\s/g;

export function normalizeLabel(raw: string): string {
  if (!raw) return '';

  // 1. Lower + strip diacritics (so "Crédit" and "credit" group together).
  let s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // 2. Strip a leading payment-method prefix ("CB ", "VIREMENT ", etc.). Loop
  //    because some banks stack multiple ("PAIEMENT CB CARREFOUR").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(PREFIX_RE, '');
    if (next === s) break;
    s = next;
  }

  // 3. Strip dates and long numeric runs.
  s = s.replace(DATE_RE, ' ');
  s = s.replace(LONG_DIGITS_RE, ' ');
  s = ` ${s} `.replace(ORPHAN_NUM_RE, ' ').trim();

  // 4. Collapse whitespace and trim.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}
