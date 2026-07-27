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
  flushSnapshots,
  lastSnapshotSucceeded,
  _setPipelineForTests,
} from '../snapshotScheduler.js';

describe('snapshotScheduler', () => {
  beforeEach(() => {
    // The 60s ceiling (see the "forces an immediate snapshot" tests below)
    // is measured with performance.now(), a monotonic clock, on purpose —
    // it must not fake `Date` alone, since that's not what the module reads.
    // Explicitly list vitest's own default fakes plus 'performance': passing
    // `toFake` at all replaces the default list rather than extending it.
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'Date', 'performance',
      ],
    });
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

  it('a rejecting pipeline does not produce an unhandled rejection, and a later markDirty still schedules a new run', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const pipeline = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      markDirty();
      await vi.advanceTimersByTimeAsync(10000);

      expect(pipeline).toHaveBeenCalledTimes(1);
      // The rejection was caught and logged, not left to reject snapshotNow's
      // own promise / surface as an unhandled rejection.
      expect(consoleError).toHaveBeenCalledWith('[snapshot] failed', expect.any(Error));

      // A subsequent markDirty still arms a brand-new run (the failure didn't
      // leave `running` stuck true).
      markDirty();
      await vi.advanceTimersByTimeAsync(10000);
      expect(pipeline).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });

  it('forces an immediate snapshot once 60s have elapsed since the first markDirty, even if dirtying never stops', async () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    // Re-dirty every 8s — always inside the 10s debounce window, so the
    // debounce timer alone would never fire on its own.
    for (let i = 0; i < 9; i++) {
      markDirty();
      await vi.advanceTimersByTimeAsync(8000);
    }

    // The 9th markDirty lands 64s after the first — past the 60s ceiling —
    // so it must force a snapshot immediately rather than re-arm again.
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('resets the ceiling window after a snapshot actually runs', async () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    for (let i = 0; i < 9; i++) {
      markDirty();
      await vi.advanceTimersByTimeAsync(8000);
    }
    expect(pipeline).toHaveBeenCalledTimes(1);

    // Continued dirtying after the forced flush gets a fresh 60s budget —
    // it shouldn't immediately force a second flush.
    markDirty();
    await vi.advanceTimersByTimeAsync(8000);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('flushSnapshots waits out an in-flight run and its queued follow-up, then does one more flush', async () => {
    const resolvers: Array<() => void> = [];
    const pipeline = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    // Get a run "in flight" directly, bypassing the debounce.
    const firstRun = snapshotNow();
    expect(pipeline).toHaveBeenCalledTimes(1);

    // Dirty while it's running — queues exactly one follow-up.
    markDirty();
    await vi.advanceTimersByTimeAsync(10000);
    expect(pipeline).toHaveBeenCalledTimes(1);

    let flushed = false;
    const flush = flushSnapshots().then(() => {
      flushed = true;
    });

    // Let the first run finish — its queued follow-up starts (call #2).
    resolvers[0]?.();
    await vi.waitFor(() => expect(pipeline).toHaveBeenCalledTimes(2));
    expect(flushed).toBe(false);

    // Let the follow-up finish too — the original chain settles, and
    // flushSnapshots (which was awaiting that whole chain) should then issue
    // its own extra flush (call #3) before resolving.
    resolvers[1]?.();
    await firstRun;
    await vi.waitFor(() => expect(pipeline).toHaveBeenCalledTimes(3));
    expect(flushed).toBe(false);

    resolvers[2]?.();
    await flush;
    expect(flushed).toBe(true);
    expect(pipeline).toHaveBeenCalledTimes(3);
  });

  it('flushSnapshots just runs a single flush when nothing is in flight', async () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    _setPipelineForTests(pipeline);
    activateSnapshots('pass');

    await flushSnapshots();

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('captures the passphrase before the run starts, immune to a concurrent deactivateSnapshots', async () => {
    let resolveRun: (() => void) | undefined;
    const seenPasses: string[] = [];
    const pipeline = vi.fn().mockImplementation(
      (pass: string) =>
        new Promise<void>((resolve) => {
          seenPasses.push(pass);
          resolveRun = resolve;
        }),
    );
    _setPipelineForTests(pipeline);
    activateSnapshots('secret-pass');

    const run = snapshotNow();
    expect(pipeline).toHaveBeenCalledWith('secret-pass');

    // Deactivate while the run is still in flight — the pipeline invocation
    // already captured 'secret-pass' as a plain argument, so this must not
    // change what it's using (and must not throw/produce a null passphrase).
    deactivateSnapshots();
    expect(isSnapshotActive()).toBe(false);

    resolveRun?.();
    await expect(run).resolves.toBeUndefined();

    expect(seenPasses).toEqual(['secret-pass']);
  });

  describe('lastSnapshotSucceeded', () => {
    it('flips to false after a failing pipeline run, then back to true once a run succeeds', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        _setPipelineForTests(async () => { throw new Error('disk full'); });
        activateSnapshots('pass');

        await snapshotNow();
        expect(lastSnapshotSucceeded()).toBe(false);

        _setPipelineForTests(async () => { /* succeeds */ });
        await snapshotNow();
        expect(lastSnapshotSucceeded()).toBe(true);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('reflects failure through flushSnapshots too', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        _setPipelineForTests(async () => { throw new Error('disk full'); });
        activateSnapshots('pass');

        await flushSnapshots();
        expect(lastSnapshotSucceeded()).toBe(false);
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});
