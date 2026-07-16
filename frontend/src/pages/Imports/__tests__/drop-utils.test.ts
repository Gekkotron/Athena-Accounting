import { describe, it, expect } from 'vitest';
import { collectDroppedFiles } from '../drop-utils';

function fakeDataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
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
});
