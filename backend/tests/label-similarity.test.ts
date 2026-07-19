// Fixture-based tests for the backend copy of label-similarity.ts.
// Kept in lock-step with frontend/src/lib/__tests__/label-similarity.test.ts
// — the two files should exercise the same cases and produce the same
// numbers so recurring-series detection matches the frontend's dedup
// similarity view.
import { describe, it, expect } from 'vitest';
import {
  jaccardTokenSimilarity,
  tokenize,
  groupMinPairwiseSimilarity,
} from '../src/lib/label-similarity.js';

describe('label-similarity backend copy', () => {
  it('tokenises to lowercase, strips punctuation, drops stopwords, drops pure-digit tokens', () => {
    const t = tokenize('CB CARREFOUR MARKET 12/03');
    expect(t.has('carrefour')).toBe(true);
    expect(t.has('market')).toBe(true);
    // Dates / rotating refs are pure digits and now drop out — they
    // otherwise inflate the union enough to sink recurring detection.
    expect(t.has('12')).toBe(false);
    expect(t.has('03')).toBe(false);
    expect(t.has('cb')).toBe(false);
  });

  it('two identical labels score 1', () => {
    expect(jaccardTokenSimilarity('SPOTIFY PREMIUM', 'SPOTIFY PREMIUM')).toBe(1);
  });

  it('completely disjoint labels score 0', () => {
    expect(jaccardTokenSimilarity('SPOTIFY', 'NETFLIX')).toBe(0);
  });

  it('shared merchant tokens produce a high score, boilerplate + rotating dates excluded', () => {
    // "CB CARREFOUR 12/03" → strip CB (stopword) and 12/03 (pure digits)
    // → {carrefour}. "CARTE CARREFOUR MARKET 15/04" → {carrefour, market}.
    // Intersection = 1, union = 2 → 0.5.
    expect(jaccardTokenSimilarity('CB CARREFOUR 12/03', 'CARTE CARREFOUR MARKET 15/04')).toBeCloseTo(0.5, 3);
  });

  it('regression: recurring wire with rotating YYYYMMDD + monthly counter clusters (≥ 0.5)', () => {
    // A common French SEPA memo shape: employer / vendor abbreviation +
    // a YYYYMMDD reference + a monthly counter. The date rotates every
    // month, and before dropping pure-digit tokens the pair scored
    // 2/6 ≈ 0.33 — below the recurring detector's 0.5 threshold, so
    // each month landed in its own singleton cluster and the pattern
    // never surfaced as a detected series. After the fix the rotating
    // date drops out, leaving {acme, pay, m042} vs {acme, pay, m043}
    // → 2/4 = 0.5.
    const s = jaccardTokenSimilarity(
      'VIR ACME PAY.20240115.M042.',
      'VIR ACME PAY.20240215.M043.',
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  it('groupMinPairwiseSimilarity picks the weakest link', () => {
    // Three labels: SPOTIFY, SPOTIFY, NETFLIX. Pairwise:
    // (SPOTIFY,SPOTIFY)=1, (SPOTIFY,NETFLIX)=0, (SPOTIFY,NETFLIX)=0.
    // Min = 0.
    expect(groupMinPairwiseSimilarity(['SPOTIFY', 'SPOTIFY', 'NETFLIX'])).toBe(0);
  });

  it('groupMinPairwiseSimilarity returns 1 for a single label', () => {
    expect(groupMinPairwiseSimilarity(['SPOTIFY'])).toBe(1);
  });

  it('two labels differing only by numeric suffix still cluster (≥ 0.5)', () => {
    // "AMAZON EU LUX" vs "AMAZON EU FR": shared {amazon, eu}, differing
    // {lux} vs {fr}. Intersection = 2, union = 4 → 0.5.
    expect(jaccardTokenSimilarity('AMAZON EU LUX', 'AMAZON EU FR')).toBeCloseTo(0.5, 3);
  });
});
