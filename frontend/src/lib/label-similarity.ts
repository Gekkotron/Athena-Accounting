// Jaccard token similarity between two transaction labels. Returns a value
// in [0, 1] where 1 == identical token sets and 0 == disjoint sets.
//
// Kept in lock-step with backend/src/lib/label-similarity.ts — the two
// files must stay identical (same tokenizer, same stopword set) so
// backend-detected recurring series match what this frontend uses for
// its own similarity checks. Edit both in the same commit.
//
// The Possibles doublons panel uses this to hide same-account / same-date /
// same-amount pairs whose labels are too different to plausibly be the same
// transaction — a threshold slider lets the user tune the sensitivity to
// their own bank's label conventions.
//
// Tokenizer choices:
//   - Split on any non-alphanumeric so accents / punctuation / dashes don't
//     count as tokens.
//   - Lowercase so "CARREFOUR" and "carrefour" match.
//   - Drop tokens shorter than 2 chars — single letters (I, A) and single
//     digits create noise.
//   - Drop pure-digit tokens (dates, SEPA refs, order ids, card BINs).
//     A recurring wire whose memo shape is "VIR <VENDOR> <ABBR>.<YYYYMMDD>.M<N>"
//     rotates the YYYYMMDD reference every month; keeping it means each
//     month lands in its own singleton cluster and the recurring detector
//     never reaches MIN_OCCURRENCES. Merchant names identify a
//     transaction, rotating numbers only add noise.
//   - Drop a small set of banking boilerplate ("cb", "vir", "prlv", "carte",
//     "paiement", …) so two card purchases don't score as similar just
//     because both start with "CARTE 6015 PAIEMENT". Merchant names are what
//     actually identify a transaction.

const STOPWORDS = new Set([
  'cb', 'carte', 'paiement', 'paiment', 'paieme', 'paiemen',
  'vir', 'virement', 'prlv', 'prelvt', 'prelevement', 'sepa',
  'retrait', 'dab', 'cheque', 'chq', 'tip', 'achat', 'facture',
  'perm', 'permanente', 'permanent',
]);

const DIGITS_ONLY = /^[0-9]+$/;

export function tokenize(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(
        (t) => t.length >= 2 && !STOPWORDS.has(t) && !DIGITS_ONLY.test(t),
      ),
  );
}

export function jaccardTokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// For a group of ≥2 transactions, the group's similarity is the MIN pairwise
// score: a 3-row group is only "similar enough" if every pair passes. This
// keeps the filter conservative — if one row is an outlier, the whole group
// is filtered out.
export function groupMinPairwiseSimilarity(labels: string[]): number {
  if (labels.length < 2) return 1;
  let min = 1;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const s = jaccardTokenSimilarity(labels[i]!, labels[j]!);
      if (s < min) min = s;
    }
  }
  return min;
}
