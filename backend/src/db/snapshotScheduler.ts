import { encryptBuffer } from '../lib/binaryEnvelope.js';
import { dataDir } from '../dataDir.js';
import { getPglite } from './client.js';
import { writeSnapshot } from './snapshotStore.js';

const DEBOUNCE_MS = 10_000;

let passphrase: string | null = null;
let timer: NodeJS.Timeout | undefined;
let running = false;
let queued = false;

// The real dump → encrypt → write pipeline. Overridable in tests via
// `_setPipelineForTests` so unit tests don't need a real PGlite instance.
async function defaultPipeline(): Promise<void> {
  const p = getPglite();
  if (!p) return;
  const blob = await p.dumpDataDir('gzip');
  const buf = Buffer.from(await blob.arrayBuffer());
  await writeSnapshot(dataDir(), encryptBuffer(buf, passphrase as string));
}

let pipeline: () => Promise<void> = defaultPipeline;

export function _setPipelineForTests(fn: (() => Promise<void>) | null): void {
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
}

export async function snapshotNow(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await pipeline();
  } finally {
    running = false;
  }
  if (queued) {
    queued = false;
    await snapshotNow();
  }
}

export function markDirty(): void {
  if (passphrase === null) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void snapshotNow();
  }, DEBOUNCE_MS);
}
