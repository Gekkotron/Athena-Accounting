import { encryptBuffer } from '../lib/binaryEnvelope.js';
import { dataDir } from '../dataDir.js';
import { getPglite } from './client.js';
import { writeSnapshot } from './snapshotStore.js';

const DEBOUNCE_MS = 10_000;
// Ceiling on how long a continuously-dirtying app can postpone a snapshot.
// markDirty() re-arms a fresh 10s debounce on every call, so a workload that
// never goes 10s idle (a busy import, a script hammering the API) could
// starve the snapshot forever. Once 60s have elapsed since the *first*
// unflushed markDirty(), flush immediately instead of re-arming again.
const MAX_WAIT_MS = 60_000;

let passphrase: string | null = null;
let timer: NodeJS.Timeout | undefined;
let running = false;
let queued = false;
// The global `performance.now()` (monotonic) rather than Date.now() (wall
// clock): a system clock change (NTP sync, DST, manual adjustment) must not
// be able to make the 60s ceiling below fire early or never — it only cares
// about elapsed time, which only a monotonic clock actually measures.
// Deliberately the ambient global rather than `import { performance } from
// 'node:perf_hooks'` — that named export is a plain captured reference, not
// a live binding to `globalThis.performance`, so fake-timer libraries (this
// module's own tests included) that patch the global in place don't affect
// it, and the ceiling would never appear to move under fake timers.
let firstDirtyAt: number | undefined;

// Resolves once the in-flight run (and any run it triggers as a queued
// follow-up) has fully settled. Created lazily by the first snapshotNow()
// call in a chain, and cleared once that whole chain is done — see
// flushSnapshots() below, which is the only consumer.
let inFlightDone: Promise<void> | undefined;
let resolveInFlightDone: (() => void) | undefined;

// The real dump → encrypt → write pipeline. Overridable in tests via
// `_setPipelineForTests` so unit tests don't need a real PGlite instance.
// Takes the passphrase as a parameter (rather than reading the module-level
// `passphrase` itself) so the caller (snapshotNow) can capture it once, up
// front, before any `await` — see the comment there for why that matters.
async function defaultPipeline(pass: string): Promise<void> {
  const p = getPglite();
  if (!p) return;
  const blob = await p.dumpDataDir('gzip');
  const buf = Buffer.from(await blob.arrayBuffer());
  await writeSnapshot(dataDir(), encryptBuffer(buf, pass));
}

let pipeline: (pass: string) => Promise<void> = defaultPipeline;

export function _setPipelineForTests(fn: ((pass: string) => Promise<void>) | null): void {
  pipeline = fn ?? defaultPipeline;
}

export function activateSnapshots(pass: string): void {
  passphrase = pass;
}

export function isSnapshotActive(): boolean {
  return passphrase !== null;
}

export function deactivateSnapshots(): void {
  passphrase = null;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  running = false;
  queued = false;
  firstDirtyAt = undefined;
}

export async function snapshotNow(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  // Capture the passphrase as the very first statement of the run, before
  // any `await` — deactivateSnapshots() can null out the module-level
  // `passphrase` at any point while dumpDataDir()/writeSnapshot() are in
  // flight, and the pipeline must keep using the value that was active when
  // the run started rather than race a concurrent deactivation.
  const pass = passphrase;
  if (pass === null) {
    // Encryption isn't active (or was deactivated before this run got a
    // chance to start) — nothing to snapshot.
    return;
  }
  // A run is actually starting — reset the ceiling window regardless of how
  // we got here (debounce timer, the ceiling's own forced flush, an
  // explicit external snapshotNow() call from shutdown, ...). The next
  // markDirty() gets a fresh 60s budget from this point.
  firstDirtyAt = undefined;
  running = true;
  if (!inFlightDone) {
    inFlightDone = new Promise((resolve) => {
      resolveInFlightDone = resolve;
    });
  }
  try {
    await pipeline(pass);
  } catch (err) {
    // Autonomous scheduling (the debounce timer, and this function's own
    // queued-follow-up recursion) must never let a pipeline failure — disk
    // full, dump failure, rename failure — surface as an unhandled
    // rejection, which kills the process. Log and swallow instead; the next
    // markDirty()/debounce cycle gets another chance.
    console.error('[snapshot] failed', err);
  } finally {
    running = false;
  }
  // A markDirty() that arrived while this run was in flight still gets its
  // follow-up run, whether this run succeeded or failed — a failure is the
  // more important case to retry (transient disk issue), and honoring
  // `queued` unconditionally keeps the single-flight bookkeeping simple.
  if (queued) {
    queued = false;
    await snapshotNow();
    return;
  }
  // The whole chain (this run plus any queued follow-up) is done — let
  // flushSnapshots() (or anything else awaiting inFlightDone) proceed.
  resolveInFlightDone?.();
  inFlightDone = undefined;
  resolveInFlightDone = undefined;
}

// Guarantees a fully up-to-date snapshot before the caller proceeds. Used by
// shutdown: a bare snapshotNow() call while a run is already in flight only
// sets the `queued` flag and returns *immediately*, without waiting for that
// run — or its own queued follow-up — to actually finish, which would let
// shutdown close the pool/exit before the last snapshot is safely on disk.
// This awaits the in-flight chain (if any) first, then performs one more
// flush so whatever was dirtied most recently is captured too.
export async function flushSnapshots(): Promise<void> {
  if (inFlightDone) {
    await inFlightDone;
  }
  await snapshotNow();
}

export function markDirty(): void {
  if (passphrase === null) return;

  const now = performance.now();
  if (firstDirtyAt === undefined) {
    firstDirtyAt = now;
  } else if (now - firstDirtyAt >= MAX_WAIT_MS) {
    // Constant mutation has kept re-arming the debounce for over a minute
    // straight — stop postponing and flush right now instead of letting a
    // busy workload starve the snapshot indefinitely.
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    void snapshotNow();
    return;
  }

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void snapshotNow();
  }, DEBOUNCE_MS);
}
