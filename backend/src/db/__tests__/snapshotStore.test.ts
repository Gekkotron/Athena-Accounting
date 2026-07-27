import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  snapshotPath,
  backupSnapshotPath,
  markerPath,
  writeSnapshot,
  readSnapshot,
  hasSnapshot,
  readMarker,
  writeMarker,
  removeBackupSnapshot,
  clearEncryption,
} from '../snapshotStore.js';

describe('snapshotStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'athena-snapshot-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('snapshotPath and markerPath', () => {
    it('returns correct paths for snapshot and marker', () => {
      const snap = snapshotPath(dir);
      const mark = markerPath(dir);
      expect(snap).toBe(path.join(dir, 'athena.db.enc'));
      expect(mark).toBe(path.join(dir, 'security.json'));
    });
  });

  describe('writeSnapshot and readSnapshot', () => {
    it('roundtrip: write then read returns same buffer', async () => {
      const data = Buffer.from('test data content');
      await writeSnapshot(dir, data);
      const read = await readSnapshot(dir);
      expect(read).toEqual(data);
    });

    it('throws when reading a missing snapshot', async () => {
      await expect(readSnapshot(dir)).rejects.toThrow();
    });

    it('falls back to .bak when the current file is missing but a backup exists', async () => {
      // Simulates a crash between writeSnapshot's two renames: `cur` never
      // landed (or was removed out from under us) but the rotated-out
      // previous snapshot is still sitting at `.bak`.
      const bakPath = path.join(dir, 'athena.db.enc.bak');
      const previous = Buffer.from('previous still-valid snapshot');
      await writeFile(bakPath, previous);

      const read = await readSnapshot(dir);
      expect(read).toEqual(previous);
    });

    it('still throws when neither the current file nor .bak exist', async () => {
      await expect(readSnapshot(dir)).rejects.toThrow();
    });
  });

  describe('hasSnapshot', () => {
    it('returns false when snapshot does not exist', async () => {
      expect(await hasSnapshot(dir)).toBe(false);
    });

    it('returns true when snapshot exists', async () => {
      await writeSnapshot(dir, Buffer.from('test'));
      expect(await hasSnapshot(dir)).toBe(true);
    });

    it('returns true when only .bak exists (cur missing, mid-rotation crash)', async () => {
      // Must agree with readSnapshot()'s .bak fallback: a recoverable
      // snapshot at .bak counts as "there is a snapshot here", otherwise a
      // corruption guard keyed off hasSnapshot() would miss exactly the
      // state it exists to catch.
      await writeFile(backupSnapshotPath(dir), Buffer.from('bak only'));
      expect(existsSync(snapshotPath(dir))).toBe(false);
      expect(await hasSnapshot(dir)).toBe(true);
    });
  });

  describe('writeSnapshot rotation', () => {
    it('second write rotates first content into .bak', async () => {
      const first = Buffer.from('first content');
      const second = Buffer.from('second content');

      await writeSnapshot(dir, first);
      const curPath = snapshotPath(dir);
      const bakPath = path.join(dir, 'athena.db.enc.bak');

      expect(existsSync(bakPath)).toBe(false);

      await writeSnapshot(dir, second);

      expect(existsSync(bakPath)).toBe(true);
      const bakContent = await readFile(bakPath);
      expect(bakContent).toEqual(first);

      const curContent = await readSnapshot(dir);
      expect(curContent).toEqual(second);
    });

    it('subsequent writes continue rotating backups', async () => {
      const first = Buffer.from('first');
      const second = Buffer.from('second');
      const third = Buffer.from('third');

      await writeSnapshot(dir, first);
      await writeSnapshot(dir, second);
      await writeSnapshot(dir, third);

      const bakPath = path.join(dir, 'athena.db.enc.bak');
      const bakContent = await readFile(bakPath);
      expect(bakContent).toEqual(second);

      const curContent = await readSnapshot(dir);
      expect(curContent).toEqual(third);
    });

    it('preserves an existing .bak when cur is absent (no zero-snapshot window)', async () => {
      // Simulates writing a fresh snapshot right after recovering via
      // readSnapshot()'s .bak fallback: `cur` is missing but `.bak` still
      // holds a good previous snapshot. The rotation logic must leave that
      // alone (nothing to rotate) rather than clearing it before the new
      // `cur` is safely in place.
      const bakPath = backupSnapshotPath(dir);
      const previousGood = Buffer.from('previous good snapshot, cur is missing');
      await writeFile(bakPath, previousGood);
      expect(existsSync(snapshotPath(dir))).toBe(false);

      const fresh = Buffer.from('fresh snapshot content');
      await writeSnapshot(dir, fresh);

      expect(await readFile(bakPath)).toEqual(previousGood);
      expect(await readSnapshot(dir)).toEqual(fresh);
    });
  });

  describe('readMarker', () => {
    it('returns null when marker file is missing', async () => {
      expect(await readMarker(dir)).toBeNull();
    });

    it('returns null when marker file contains unreadable JSON', async () => {
      const markerFile = markerPath(dir);
      await writeFile(markerFile, 'not json {invalid}');
      expect(await readMarker(dir)).toBeNull();
    });

    it('returns null when marker mode is unknown', async () => {
      const markerFile = markerPath(dir);
      await writeFile(markerFile, JSON.stringify({ mode: 'unknown-mode' }));
      expect(await readMarker(dir)).toBeNull();
    });

    it('returns "encrypted" when marker contains encrypted mode', async () => {
      const markerFile = markerPath(dir);
      await writeFile(markerFile, JSON.stringify({ mode: 'encrypted' }));
      expect(await readMarker(dir)).toBe('encrypted');
    });

    it('returns "disable-pending" when marker contains disable-pending mode', async () => {
      const markerFile = markerPath(dir);
      await writeFile(markerFile, JSON.stringify({ mode: 'disable-pending' }));
      expect(await readMarker(dir)).toBe('disable-pending');
    });
  });

  describe('writeMarker', () => {
    it('writes encrypted mode to marker', async () => {
      await writeMarker(dir, 'encrypted');
      const markerFile = markerPath(dir);
      const content = await readFile(markerFile, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed.mode).toBe('encrypted');
    });

    it('writes disable-pending mode to marker', async () => {
      await writeMarker(dir, 'disable-pending');
      const markerFile = markerPath(dir);
      const content = await readFile(markerFile, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed.mode).toBe('disable-pending');
    });

    it('overwrites existing marker', async () => {
      await writeMarker(dir, 'encrypted');
      await writeMarker(dir, 'disable-pending');
      expect(await readMarker(dir)).toBe('disable-pending');
    });
  });

  describe('removeBackupSnapshot', () => {
    it('removes only .bak, leaving cur and the marker untouched', async () => {
      await writeSnapshot(dir, Buffer.from('first'));
      await writeSnapshot(dir, Buffer.from('second'));
      await writeMarker(dir, 'encrypted');

      const bakPath = backupSnapshotPath(dir);
      expect(existsSync(bakPath)).toBe(true);

      await removeBackupSnapshot(dir);

      expect(existsSync(bakPath)).toBe(false);
      expect(await readSnapshot(dir)).toEqual(Buffer.from('second'));
      expect(await readMarker(dir)).toBe('encrypted');
    });

    it('does not error when .bak does not exist', async () => {
      await expect(removeBackupSnapshot(dir)).resolves.not.toThrow();
    });
  });

  describe('clearEncryption', () => {
    it('removes snapshot, .bak, and marker when all exist', async () => {
      await writeSnapshot(dir, Buffer.from('content'));
      await writeSnapshot(dir, Buffer.from('new content'));
      await writeMarker(dir, 'encrypted');

      const curPath = snapshotPath(dir);
      const bakPath = path.join(dir, 'athena.db.enc.bak');
      const markerFile = markerPath(dir);

      expect(existsSync(curPath)).toBe(true);
      expect(existsSync(bakPath)).toBe(true);
      expect(existsSync(markerFile)).toBe(true);

      await clearEncryption(dir);

      expect(existsSync(curPath)).toBe(false);
      expect(existsSync(bakPath)).toBe(false);
      expect(existsSync(markerFile)).toBe(false);
    });

    it('does not error when files do not exist', async () => {
      expect(await hasSnapshot(dir)).toBe(false);
      await expect(clearEncryption(dir)).resolves.not.toThrow();
    });

    it('also removes a stray .tmp file left behind by a failed enable', async () => {
      await writeSnapshot(dir, Buffer.from('content'));
      await writeMarker(dir, 'encrypted');
      const tmpPath = path.join(dir, 'athena.db.enc.tmp');
      await writeFile(tmpPath, 'leftover from an interrupted write');

      expect(existsSync(tmpPath)).toBe(true);

      await clearEncryption(dir);

      expect(existsSync(tmpPath)).toBe(false);
    });
  });

  describe('tmp file handling', () => {
    it('ignores and overwrites leftover .tmp from simulated interruption', async () => {
      const tmpPath = path.join(dir, 'athena.db.enc.tmp');
      const oldTmpContent = Buffer.from('leftover tmp data');
      await writeFile(tmpPath, oldTmpContent);

      const newContent = Buffer.from('new snapshot data');
      await writeSnapshot(dir, newContent);

      expect(existsSync(tmpPath)).toBe(false);
      const curContent = await readSnapshot(dir);
      expect(curContent).toEqual(newContent);
    });
  });
});
