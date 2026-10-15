import { describe, it, expect } from 'vitest';
import { mergeGainSeries, type TimeseriesRow } from '../merge-gains.js';

const row = (account_id: number, bucket: string, delta: string, cumulative: string): TimeseriesRow => ({
  account_id,
  currency: 'EUR',
  bucket,
  delta,
  cumulative,
});

const pt = (bucket: string, valueCents: number) => ({
  bucket,
  contributedCents: 0,
  valueCents,
  estimated: false,
});

describe('mergeGainSeries', () => {
  const rows = [
    row(1, '2026-01-01', '1000.00', '1000.00'),
    row(1, '2026-01-05', '-100.00', '900.00'),
    row(2, '2026-01-01', '50.00', '50.00'),
  ];

  it('returns rows unchanged when there is no gain series (flag off)', () => {
    expect(mergeGainSeries(rows, [], {})).toBe(rows);
  });

  it('replaces the account rows with dense Valeur rows and leaves others untouched', () => {
    const out = mergeGainSeries(
      rows,
      [
        {
          accountId: 1,
          currency: 'EUR',
          points: [pt('2026-01-01', 100000), pt('2026-01-02', 100500), pt('2026-01-03', 100200)],
        },
      ],
      {},
    );
    expect(out).toEqual([
      row(1, '2026-01-01', '1000.00', '1000.00'),
      row(1, '2026-01-02', '5.00', '1005.00'),
      row(1, '2026-01-03', '-3.00', '1002.00'),
      row(2, '2026-01-01', '50.00', '50.00'),
    ]);
  });

  it('clips buckets to the requested window like the SQL', () => {
    const out = mergeGainSeries(
      [],
      [{ accountId: 1, currency: 'EUR', points: [pt('2026-01-01', 100), pt('2026-02-01', 200), pt('2026-03-01', 300)] }],
      { fromDate: '2026-02-01', toDate: '2026-02-28' },
    );
    expect(out).toEqual([row(1, '2026-02-01', '2.00', '2.00')]);
  });

  it('keeps account_id, bucket ordering', () => {
    const out = mergeGainSeries(
      [row(3, '2026-01-01', '1.00', '1.00')],
      [{ accountId: 2, currency: 'EUR', points: [pt('2026-01-01', 100)] }],
      {},
    );
    expect(out.map((r) => r.account_id)).toEqual([2, 3]);
  });
});
