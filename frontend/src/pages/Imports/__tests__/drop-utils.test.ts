import { describe, it, expect } from 'vitest';
import { collectDroppedFiles } from '../drop-utils';

function fakeDataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['Files'],
  } as unknown as DataTransfer;
}

// Minimal FileSystemEntry-ish shape for the webkit path. Only the fields
// collectDroppedFiles touches — that's what production Chrome exposes at
// runtime, so this stays honest to the real API surface.
type FakeEntry =
  | { isFile: true; isDirectory: false; file: (ok: (f: File) => void, fail: () => void) => void }
  | { isFile: false; isDirectory: true; createReader: () => { readEntries: (ok: (e: FakeEntry[]) => void, fail: () => void) => void } };

function fileEntry(f: File, opts: { failFileCallback?: boolean } = {}): FakeEntry {
  return {
    isFile: true, isDirectory: false,
    file: (ok, fail) => (opts.failFileCallback ? fail() : ok(f)),
  };
}

// Directory reader that yields `batches` on successive readEntries() calls.
// The last batch is [] to terminate the walk loop (matches spec: reader
// signals end-of-directory by returning an empty batch).
function dirEntry(batches: FakeEntry[][], opts: { failReader?: boolean } = {}): FakeEntry {
  let i = 0;
  return {
    isFile: false, isDirectory: true,
    createReader: () => ({
      readEntries: (ok, fail) => {
        if (opts.failReader) { fail(); return; }
        const batch = batches[i++] ?? [];
        ok(batch);
      },
    }),
  };
}

// Builds a DataTransfer.items list where each item's webkitGetAsEntry()
// returns the entry at the same index. The first item's presence of
// webkitGetAsEntry is what collectDroppedFiles feature-detects on.
function itemsFor(entries: (FakeEntry | null)[]): DataTransfer {
  const items = entries.map((e) => ({
    webkitGetAsEntry: () => e,
  }));
  return {
    files: [] as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: ['Files'],
  } as unknown as DataTransfer;
}

describe('collectDroppedFiles', () => {
  it('falls back to dt.files when webkitGetAsEntry is unavailable', async () => {
    const a = new File(['x'], 'a.csv', { type: 'text/csv' });
    const b = new File(['x'], 'b.csv', { type: 'text/csv' });
    const result = await collectDroppedFiles(fakeDataTransfer([a, b]));
    expect(result.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
  });

  it('returns [] for an empty DataTransfer', async () => {
    const result = await collectDroppedFiles(fakeDataTransfer([]));
    expect(result).toEqual([]);
  });

  it('webkit items API: collects a single top-level file entry', async () => {
    const a = new File(['x'], 'top.pdf', { type: 'application/pdf' });
    const result = await collectDroppedFiles(itemsFor([fileEntry(a)]));
    expect(result.map((f) => f.name)).toEqual(['top.pdf']);
  });

  it('webkit items API: walks a directory recursively, batched entries', async () => {
    const a = new File(['x'], 'child-a.csv');
    const b = new File(['x'], 'child-b.csv');
    const nested = new File(['x'], 'nested.csv');
    const subdir = dirEntry([[fileEntry(nested)]]);
    const root = dirEntry([[fileEntry(a), fileEntry(b)], [subdir]]);
    const result = await collectDroppedFiles(itemsFor([root]));
    expect(result.map((f) => f.name).sort()).toEqual(
      ['child-a.csv', 'child-b.csv', 'nested.csv'].sort(),
    );
  });

  it('webkit items API: silently drops a file whose file() callback errors', async () => {
    const ok = new File(['x'], 'ok.csv');
    const bad = new File(['x'], 'bad.csv');
    const result = await collectDroppedFiles(itemsFor([
      fileEntry(ok),
      fileEntry(bad, { failFileCallback: true }),
    ]));
    expect(result.map((f) => f.name)).toEqual(['ok.csv']);
  });

  it('webkit items API: silently drops a directory whose reader errors', async () => {
    const a = new File(['x'], 'sibling.csv');
    const result = await collectDroppedFiles(itemsFor([
      dirEntry([], { failReader: true }),
      fileEntry(a),
    ]));
    expect(result.map((f) => f.name)).toEqual(['sibling.csv']);
  });

  it('webkit items API: a null webkitGetAsEntry() (empty item) is skipped', async () => {
    const a = new File(['x'], 'kept.csv');
    const result = await collectDroppedFiles(itemsFor([null, fileEntry(a)]));
    expect(result.map((f) => f.name)).toEqual(['kept.csv']);
  });
});
