import { describe, it, expect } from 'vitest';
import { uploadAndPrune } from '../src/domain/backup/runner.js';
import type { BackupProvider } from '../src/domain/backup/providers.js';

function memoryProvider(seed: string[] = []): BackupProvider & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>(seed.map((n) => [n, Buffer.from('old')]));
  return {
    files,
    async upload(name, bytes) {
      files.set(name, bytes);
    },
    async list() {
      return [...files.keys()].sort();
    },
    async remove(name) {
      files.delete(name);
    },
  };
}

const day = (d: string) => `athena-backup-${d}-030000.enc.json`;

describe('uploadAndPrune', () => {
  it('uploads and keeps everything under the cap', async () => {
    const p = memoryProvider([day('2026-08-01')]);
    await uploadAndPrune(p, day('2026-08-02'), Buffer.from('new'), 30);
    expect([...p.files.keys()].sort()).toEqual([day('2026-08-01'), day('2026-08-02')]);
  });
  it('prunes the oldest files beyond keepLast', async () => {
    const p = memoryProvider([day('2026-08-01'), day('2026-08-02'), day('2026-08-03')]);
    await uploadAndPrune(p, day('2026-08-04'), Buffer.from('new'), 2);
    expect([...p.files.keys()].sort()).toEqual([day('2026-08-03'), day('2026-08-04')]);
  });
  it('keepLast 1 keeps exactly the file just uploaded', async () => {
    const p = memoryProvider([day('2026-08-01')]);
    await uploadAndPrune(p, day('2026-08-02'), Buffer.from('new'), 1);
    expect([...p.files.keys()]).toEqual([day('2026-08-02')]);
  });
});
