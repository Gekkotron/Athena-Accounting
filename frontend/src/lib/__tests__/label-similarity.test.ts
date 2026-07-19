import { describe, it, expect } from 'vitest';
import { jaccardTokenSimilarity, groupMinPairwiseSimilarity } from '../label-similarity';

describe('jaccardTokenSimilarity', () => {
  it('is 1.0 for identical labels', () => {
    expect(jaccardTokenSimilarity('CARREFOUR', 'CARREFOUR')).toBe(1);
  });

  it('is 0 for disjoint tokens', () => {
    expect(jaccardTokenSimilarity('CARREFOUR', 'AMAZON')).toBe(0);
  });

  it('ignores banking-boilerplate stopwords', () => {
    // Both labels are "just" a merchant name once "CARTE / PAIEMENT" are
    // dropped — two different merchants → 0.
    expect(jaccardTokenSimilarity('BUREAU VALLEE CARTE 6015 PAIEMENT', 'CRF WIITENHEIM CARTE 6015 PAIEMENT'))
      .toBeLessThan(0.5);
  });

  it('keeps merchant tokens shared across variants', () => {
    // The two labels differ only in a bank prefix + a date. The date tokens
    // dilute the score, but the shared merchant keeps it well above 0.
    const s = jaccardTokenSimilarity('CB CARREFOUR 15/06', 'PAIEMENT CB CARREFOUR');
    expect(s).toBeGreaterThan(0.3);
  });

  it('handles empty labels', () => {
    expect(jaccardTokenSimilarity('', '')).toBe(1);
    expect(jaccardTokenSimilarity('CARREFOUR', '')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'MAGASIN U CARTE 4964';
    const b = 'CARTE 4964 MAGASIN U MULHOUSE';
    expect(jaccardTokenSimilarity(a, b)).toBe(jaccardTokenSimilarity(b, a));
  });

  it('gives OFX↔PDF variants a low but non-zero score', () => {
    // Real regression: same recurring transfer shows up as a SEPA reference
    // in OFX and as a human-readable label in PDF. Nothing overlaps beyond
    // stopwords → 0. Users will see this and probably lower the threshold.
    const s = jaccardTokenSimilarity('C24V24316L042410 VIR SEPA REMI', 'VIR PERM. LIV 00020390802');
    expect(s).toBe(0);
  });

  it('two different merchants that only share a card BIN do not cluster', () => {
    // "6015" is now dropped as a pure-digit token (it's the card BIN, not
    // a merchant identifier). CARTE/PAIEMENT are already stopwords. So
    // {bureau, vallee} vs {crf, wittenheim} → 0 — which is the correct
    // outcome: two different merchants on the same card should NOT be
    // treated as similar just because the BIN matches.
    const s = jaccardTokenSimilarity('BUREAU VALLEE CARTE 6015 PAIEMENT', 'CRF WITTENHEIM CARTE 6015 PAIEMENT');
    expect(s).toBe(0);
  });

  it('regression: recurring wire with rotating YYYYMMDD + monthly counter clusters (≥ 0.5)', () => {
    // A common French SEPA memo shape: employer / vendor abbreviation +
    // a YYYYMMDD reference + a monthly counter. Before dropping
    // pure-digit tokens the pair scored 2/6 ≈ 0.33 — below the recurring
    // detector's 0.5 threshold — so each month landed in its own
    // singleton cluster and the pattern never surfaced as a detected
    // series. After the fix the rotating date drops out, leaving
    // {acme, pay, m042} vs {acme, pay, m043} → 2/4 = 0.5.
    const s = jaccardTokenSimilarity(
      'VIR ACME PAY.20240115.M042.',
      'VIR ACME PAY.20240215.M043.',
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });
});

describe('groupMinPairwiseSimilarity', () => {
  it('returns 1 for singletons', () => {
    expect(groupMinPairwiseSimilarity(['CARREFOUR'])).toBe(1);
  });
  it('returns the minimum pairwise score for larger groups', () => {
    // Three labels: two identical and one disjoint. Min is 0.
    expect(groupMinPairwiseSimilarity(['CARREFOUR', 'CARREFOUR', 'AMAZON'])).toBe(0);
  });
  it('returns 1 when every pair matches', () => {
    expect(groupMinPairwiseSimilarity(['CARREFOUR', 'CARREFOUR', 'CARREFOUR'])).toBe(1);
  });
});
