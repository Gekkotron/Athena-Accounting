import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// snapshotScheduler.ts statically imports client.ts for the real dump
// pipeline, and client.ts does a top-level-await PGlite/Postgres connect
// keyed off env.ts at import time. Mock it out so this suite exercises only
// the debounce/single-flight logic (via `_setPipelineForTests`) without
// booting a real database or requiring env vars.
vi.mock('../client.js', () => ({
  getPglite: () => null,
  dbDriver: 'pglite',
}));

import {
  activateSnapshots,
  deactivateSnapshots,
  isSnapshotActive,
  markDirty,
  snapshotNow,
  _setPipelineForTests,
} from '../snapshotScheduler.js';

describe('snapshotScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    deactivateSnapshots();
    _setPipelineForTests(null);
    vi.useRealTimers();
  });

  it('is inactive until activateSnapshots is called', () => {
    expect(isSnapshotActive()).toBe(false);
  });

  it('becomes active after activateSnapshots', () => {
    activateSnapshots('pass');
    expect(isSnapshotActive()).toBe(true);
  });

  it('coalesces two markDirty calls within the debounce window into one run', async () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    markDirty();
    await vi.advanceTimersByTimeAsync(5000);
    markDirty();
    await vi.advanceTimersByTimeAsync(10000);

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('does not fire when inactive (no activateSnapshots)', async () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);

    markDirty();
    await vi.advanceTimersByTimeAsync(15000);

    expect(pipeline).not.toHaveBeenCalled();
  });

  it('runs exactly one follow-up when markDirty fires while a snapshot is in flight', async () => {
    // Each call gets its own resolver (queued in order) — the scheduler's
    // follow-up recurses into a *second* pipeline() invocation before the
    // first one's `await` unwinds, so reusing a single resolver variable
    // would deadlock the second call against itself.
    const resolvers: Array<() => void> = [];
    const pipeline = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    // Kick off the first run directly (bypassing the debounce) to get it "in flight".
    const firstRun = snapshotNow();
    expect(pipeline).toHaveBeenCalledTimes(1);

    // markDirty while the run is in flight should queue exactly one follow-up.
    markDirty();
    await vi.advanceTimersByTimeAsync(10000);
    // Follow-up shouldn't have started yet — the first run hasn't resolved.
    expect(pipeline).toHaveBeenCalledTimes(1);

    resolvers[0]?.();
    // Let the microtask queue drain so the queued follow-up's synchronous
    // recursive call into pipeline() (call #2) actually happens before we
    // assert on / resolve it.
    await vi.waitFor(() => expect(pipeline).toHaveBeenCalledTimes(2));

    // Resolve the second run so `firstRun` (which awaits the recursive
    // follow-up) can settle.
    resolvers[1]?.();
    await firstRun;

    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
