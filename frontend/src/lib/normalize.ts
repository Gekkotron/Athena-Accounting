// Mirror of backend/src/domain/imports/normalize.ts. Kept in sync by hand —
// the two are deliberately identical so the frontend can preview how a rule's
// keyword will be transformed before saving.

const PREFIX_RE =
  /^(cb|carte|paiement|paiment|achat|vir(ement)?|prlv|prelvt|prelevement|cheque|chq|tip|retrait|dab)\s+/i;

const DATE_RE = /\b\d{1,2}([\/.\-]\d{1,2}([\/.\-]\d{2,4})?)?\b/g;
const LONG_DIGITS_RE = /\b\d{6,}\b/g;
const ORPHAN_NUM_RE = /\s\d{3,5}\s/g;

export function normalizeLabel(raw: string): string {
  if (!raw) return '';

  let s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  for (let i = 0; i < 3; i++) {
    const next = s.replace(PREFIX_RE, '');
    if (next === s) break;
    s = next;
  }

  s = s.replace(DATE_RE, ' ');
  s = s.replace(LONG_DIGITS_RE, ' ');
  s = ` ${s} `.replace(ORPHAN_NUM_RE, ' ').trim();
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}
