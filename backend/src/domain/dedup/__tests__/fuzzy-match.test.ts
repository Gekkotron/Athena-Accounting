import { describe, it, expect } from 'vitest';
import {
  MAX_DAY_DELTA,
  MAX_AMOUNT_DELTA,
  LABEL_JACCARD_THRESHOLD,
  hasLabelSignal,
  passesHardWindows,
  fuzzyMatchesPair,
  type FuzzyCandidate,
} from '../fuzzy-match.js';

function row(overrides: Partial<FuzzyCandidate> = {}): FuzzyCandidate {
  return {
    date: '2026-06-15',
    amount: '-25.30',
    normalizedLabel: 'carrefour market',
    rawLabel: 'CB CARREFOUR MARKET 15/06',
    ...overrides,
  };
}

describe('fuzzy-match constants', () => {
  it('locks the thresholds documented in the spec', () => {
    expect(MAX_DAY_DELTA).toBe(3);
    expect(MAX_AMOUNT_DELTA).toBe(0.02);
    expect(LABEL_JACCARD_THRESHOLD).toBe(0.5);
  });
});

describe('hasLabelSignal', () => {
  it('rejects empty raw labels', () => {
    expect(hasLabelSignal({ rawLabel: '' })).toBe(false);
  });
  it('rejects labels whose tokens are all stopwords + digits', () => {
    expect(hasLabelSignal({ rawLabel: 'CB 12345' })).toBe(false);
  });
  it('accepts labels with at least one merchant-y token', () => {
    expect(hasLabelSignal({ rawLabel: 'CB CARREFOUR 12345' })).toBe(true);
  });
});

describe('passesHardWindows', () => {
  it('accepts an exact tuple', () => {
    expect(passesHardWindows(row(), row())).toBe(true);
  });
  it.each([1, 2, 3])('accepts Δdate = %s days', (delta) => {
    const b = row({ date: shiftDate('2026-06-15', delta) });
    expect(passesHardWindows(row(), b)).toBe(true);
  });
  it('rejects Δdate = 4 days', () => {
    const b = row({ date: shiftDate('2026-06-15', 4) });
    expect(passesHardWindows(row(), b)).toBe(false);
  });
  it.each(['-25.30', '-25.31', '-25.32'])('accepts amount within window: %s', (amount) => {
    expect(passesHardWindows(row(), row({ amount }))).toBe(true);
  });
  it('rejects amount out of window (Δ = 0.03)', () => {
    expect(passesHardWindows(row(), row({ amount: '-25.33' }))).toBe(false);
  });
  it('rejects opposite sign', () => {
    expect(passesHardWindows(row(), row({ amount: '25.30' }))).toBe(false);
  });
});

describe('fuzzyMatchesPair', () => {
  it('accepts a same-merchant near-duplicate', () => {
    const a = row({ rawLabel: 'CB CARREFOUR MARKET 15/06' });
    const b = row({
      date: '2026-06-17',
      amount: '-25.31',
      rawLabel: 'PAIEMENT CARREFOUR MARKET REF-98',
    });
    expect(fuzzyMatchesPair(a, b)).toBe(true);
  });
  it('rejects when labels are token-disjoint (Jaccard = 0)', () => {
    const a = row({ rawLabel: 'CB CARREFOUR MARKET' });
    const b = row({ rawLabel: 'SNCF PARIS LYON' });
    expect(fuzzyMatchesPair(a, b)).toBe(false);
  });
  it('rejects when either normalized label has no token signal', () => {
    const a = row({ rawLabel: '' });
    expect(fuzzyMatchesPair(a, row())).toBe(false);
  });
  it('rejects opposite sign even with identical label', () => {
    expect(fuzzyMatchesPair(row(), row({ amount: '25.30' }))).toBe(false);
  });
});

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
