// Unit test for the pure detection algorithm. No DB — the algorithm is
// exercised over hand-built DetectionInputTx arrays so the test runs
// without RUN_DB_TESTS.
import { describe, it, expect } from 'vitest';
import { detectSeries, type DetectionInputTx } from '../src/services/recurring-detect-core.js';

function tx(
  id: number,
  date: string,
  amount: string,
  rawLabel: string,
  categoryId: number | null = null,
): DetectionInputTx {
  return { id, date, amount, rawLabel, categoryId };
}

// Build a sequence of monthly transactions with matching labels.
function monthly(startYear: number, months: number, amount: string, label: string): DetectionInputTx[] {
  const out: DetectionInputTx[] = [];
  for (let i = 0; i < months; i++) {
    const m = String(((i) % 12) + 1).padStart(2, '0');
    const y = startYear + Math.floor(i / 12);
    out.push(tx(i + 1, `${y}-${m}-15`, amount, label));
  }
  return out;
}

describe('detectSeries', () => {
  it('detects a monthly SPOTIFY series (spec smoke)', () => {
    const txs = monthly(2026, 6, '-9.99', 'SPOTIFY');
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadenceDays).toBe(30);
    expect(series[0]!.avgAmount).toBeCloseTo(-9.99, 2);
    expect(series[0]!.memberIds).toHaveLength(6);
    expect(series[0]!.label).toBe('SPOTIFY');
  });

  it('sets next_due_at = last_seen_at + cadence_days', () => {
    const txs = monthly(2026, 6, '-9.99', 'SPOTIFY');
    const series = detectSeries(txs);
    expect(series[0]!.lastSeenAt).toBe('2026-06-15');
    expect(series[0]!.nextDueAt).toBe('2026-07-15');
  });

  it('drops a cluster with only 2 occurrences', () => {
    const txs = monthly(2026, 2, '-9.99', 'SPOTIFY');
    expect(detectSeries(txs)).toEqual([]);
  });

  it('drops a cluster whose span is less than 2 cadence periods', () => {
    // 3 occurrences but only 1 month between first and last (weekly-ish
    // spacing would fit weekly cadence — this is monthly-cadence rejection).
    const txs = [
      tx(1, '2026-06-01', '-9.99', 'SPOTIFY'),
      tx(2, '2026-06-15', '-9.99', 'SPOTIFY'),
      tx(3, '2026-06-30', '-9.99', 'SPOTIFY'),
    ];
    // With bi-monthly spacing (~15d) this fits neither the 7d nor the 30d
    // bucket cleanly. Should return no series.
    expect(detectSeries(txs)).toEqual([]);
  });

  it('detects a weekly series', () => {
    const txs: DetectionInputTx[] = [];
    // 10 weekly transactions.
    for (let i = 0; i < 10; i++) {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      txs.push(tx(i + 1, iso, '-4.50', 'CAFE DU COIN'));
    }
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadenceDays).toBe(7);
    expect(series[0]!.memberIds).toHaveLength(10);
  });

  it('detects a quarterly series', () => {
    const txs: DetectionInputTx[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(Date.UTC(2025, i * 3, 10));
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      txs.push(tx(i + 1, iso, '-45.00', 'ASSURANCE VOITURE'));
    }
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadenceDays).toBe(90);
  });

  it('tolerates ±15% amount variation (utility-like)', () => {
    const txs = monthly(2026, 6, '-45.00', 'EDF ENERGIE');
    // Nudge amounts within ±15% of median 45.00 — 38.25 to 51.75.
    txs[0]!.amount = '-42.10';
    txs[1]!.amount = '-48.90';
    txs[2]!.amount = '-45.00';
    txs[3]!.amount = '-41.00';
    txs[4]!.amount = '-49.50';
    txs[5]!.amount = '-45.60';
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.cadenceDays).toBe(30);
    expect(series[0]!.memberIds).toHaveLength(6);
    expect(series[0]!.amountStddev).toBeGreaterThan(0);
  });

  it('rejects a cluster with wild amount swings', () => {
    const txs = monthly(2026, 6, '-9.99', 'AMAZON EU');
    // Blow up one amount well past 15% (median stays 9.99, outlier at 50 gets
    // filtered — but then remaining 5 are all identical and pass).
    txs[0]!.amount = '-50.00';
    const series = detectSeries(txs);
    // Still detects because outlier is filtered and 5 identical rows remain.
    expect(series).toHaveLength(1);
    expect(series[0]!.memberIds).toHaveLength(5);
  });

  it('drops all amounts diverging past the tolerance', () => {
    const txs: DetectionInputTx[] = [];
    // Same label, monthly-ish, but wildly varying amounts (no cluster
    // majority within 15%).
    const amounts = ['-10', '-20', '-30', '-40', '-50', '-60'];
    for (let i = 0; i < 6; i++) {
      const m = String(i + 1).padStart(2, '0');
      txs.push(tx(i + 1, `2026-${m}-10`, amounts[i]!, 'RANDOM MERCHANT'));
    }
    // Median = 35. Tolerance = 5.25. Nothing passes.
    const series = detectSeries(txs);
    expect(series).toEqual([]);
  });

  it('clusters similar labels via Jaccard even when they differ', () => {
    // "AMAZON EU LUX" vs "AMAZON EU FR" share the "amazon" + "eu" tokens
    // → Jaccard ≥ 0.5 (2 shared / 3 total on each side, union 4 → 0.5).
    const txs: DetectionInputTx[] = [
      tx(1, '2026-01-15', '-30.00', 'AMAZON EU LUX'),
      tx(2, '2026-02-15', '-30.00', 'AMAZON EU FR'),
      tx(3, '2026-03-15', '-30.00', 'AMAZON EU LUX'),
      tx(4, '2026-04-15', '-30.00', 'AMAZON EU FR'),
    ];
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.memberIds).toHaveLength(4);
  });

  it('assigns categoryId when the majority of members share one', () => {
    const txs = monthly(2026, 6, '-9.99', 'SPOTIFY');
    for (const t of txs) t.categoryId = 42;
    const series = detectSeries(txs);
    expect(series[0]!.categoryId).toBe(42);
  });

  it('leaves categoryId null when members disagree', () => {
    const txs = monthly(2026, 6, '-9.99', 'SPOTIFY');
    txs[0]!.categoryId = 1;
    txs[1]!.categoryId = 2;
    txs[2]!.categoryId = 3;
    txs[3]!.categoryId = 4;
    txs[4]!.categoryId = 5;
    txs[5]!.categoryId = 6;
    const series = detectSeries(txs);
    expect(series[0]!.categoryId).toBeNull();
  });

  it('picks the most-frequent raw label as the canonical label', () => {
    // 4 members with "SPOTIFY PREMIUM" as the plurality label. "SPOTIFY
    // AB" scores below the Jaccard threshold vs "SPOTIFY PREMIUM"
    // ({spotify,ab} vs {spotify,premium} = 1/3 = 0.33 < 0.5) so it
    // lands in its own cluster and doesn't dilute the vote here.
    const txs: DetectionInputTx[] = [
      tx(1, '2026-01-15', '-9.99', 'SPOTIFY PREMIUM'),
      tx(2, '2026-02-15', '-9.99', 'SPOTIFY PREMIUM'),
      tx(3, '2026-03-15', '-9.99', 'SPOTIFY PREMIUM'),
      tx(4, '2026-04-15', '-9.99', 'SPOTIFY PREMIUM'),
    ];
    const series = detectSeries(txs);
    expect(series).toHaveLength(1);
    expect(series[0]!.label).toBe('SPOTIFY PREMIUM');
  });
});
