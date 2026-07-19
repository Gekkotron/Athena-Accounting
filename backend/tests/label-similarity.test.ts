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
  it('tokenises to lowercase, strips punctuation, drops stopwords', () => {
    const t = tokenize('CB CARREFOUR MARKET 12/03');
    expect(t.has('carrefour')).toBe(true);
    expect(t.has('market')).toBe(true);
    expect(t.has('12')).toBe(true);
    expect(t.has('03')).toBe(true);
    expect(t.has('cb')).toBe(false);
  });

  it('two identical labels score 1', () => {
    expect(jaccardTokenSimilarity('SPOTIFY PREMIUM', 'SPOTIFY PREMIUM')).toBe(1);
  });

  it('completely disjoint labels score 0', () => {
    expect(jaccardTokenSimilarity('SPOTIFY', 'NETFLIX')).toBe(0);
  });

  it('shared merchant tokens produce a high score, boilerplate excluded', () => {
    // Both "CB CARREFOUR 12/03" and "CARTE CARREFOUR MARKET 15/04" strip
    // CB/CARTE (stopwords). Remaining tokens: {carrefour, 12, 03} vs
    // {carrefour, market, 15, 04}. Intersection = 1, union = 6.
    expect(jaccardTokenSimilarity('CB CARREFOUR 12/03', 'CARTE CARREFOUR MARKET 15/04')).toBeCloseTo(1 / 6, 3);
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
