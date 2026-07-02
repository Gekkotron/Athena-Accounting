import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BalanceChart } from '../BalanceChart';
import type { BalancePoint } from '../../api/types';

function point(bucket: string, cumulative: string): BalancePoint {
  return { account_id: 1, currency: 'EUR', bucket, delta: '0', cumulative };
}

describe('BalanceChart checkpoint positioning', () => {
  it('positions a checkpoint by its bucket INDEX, not by a whole-range time fraction', () => {
    // Regression test: a dense cluster of daily buckets in 2023 followed by
    // two sparse, far-apart buckets in 2026. Before the fix, cx was computed
    // from (checkpointTime - firstTime) / (lastTime - firstTime) fed into an
    // INDEX-based xScale — since buckets are irregularly spaced in time, a
    // checkpoint dated 2026-01-30 (near the 2023-11 index by time-fraction)
    // would render far from its own bucket's visual position.
    const points: BalancePoint[] = [];
    for (let d = 1; d <= 20; d++) {
      const day = String(d).padStart(2, '0');
      points.push(point(`2023-01-${day}`, '100'));
    }
    points.push(point('2026-01-15', '200'));
    points.push(point('2026-06-15', '300'));

    const checkpoints = [{ date: '2026-01-30', expectedAmount: 250 }];

    const { container } = render(
      <BalanceChart points={points} currency="EUR" checkpoints={checkpoints} />,
    );

    // data buckets sorted: 20 daily 2023 entries (idx 0..19), then
    // 2026-01-15 (idx 20), then 2026-06-15 (idx 21). The checkpoint
    // (2026-01-30) falls between idx 20 and idx 21 — its cx must be
    // computed within that single index gap, not from the full-range time
    // fraction (which would place it far earlier, near the dense 2023
    // cluster).
    const w = 1000;
    const pad = { left: 64, right: 24 };
    const innerW = w - pad.left - pad.right;
    const xScale = (i: number) => pad.left + (i / 21) * innerW; // data.length - 1 = 21

    // The diamond marker is the only <path> whose "d" starts with
    // "M {cx} {cy-5}" and is drawn inside a <g> — select via its stroke
    // color set which distinguishes it from the line/area paths (those use
    // fill="url(...)" or fill="none" with a fixed stroke, but neither draws
    // a diamond). Simplest robust hook: query all <path> elements and find
    // the one whose "d" attribute has exactly 4 "L"/"M" segments forming a
    // diamond (5 coordinate commands: M,L,L,L,Z).
    const diamond = Array.from(container.querySelectorAll('path')).find((p) => {
      const d = p.getAttribute('d') ?? '';
      return /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+ Z$/.test(d);
    });
    expect(diamond).toBeTruthy();
    const d = diamond!.getAttribute('d')!;
    const cxMatch = d.match(/^M ([\d.]+)/);
    expect(cxMatch).toBeTruthy();
    const cx = Number(cxMatch![1]);

    // cx must land strictly between idx 20 and idx 21's x position — i.e.
    // in the same visual neighborhood as the two 2026 buckets it sits
    // between, and NOT anywhere near the dense 2023 cluster (idx 0..19).
    expect(cx).toBeGreaterThan(xScale(20) - 1);
    expect(cx).toBeLessThanOrEqual(xScale(21) + 1);
  });
});
