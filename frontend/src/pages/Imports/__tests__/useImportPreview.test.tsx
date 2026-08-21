import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportPreview } from '../useImportPreview';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

vi.mock('../../../api/imports', () => ({
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));
import { previewImport, commitImport } from '../../../api/imports';
const previewMock = vi.mocked(previewImport);
const commitMock = vi.mocked(commitImport);

beforeEach(() => { previewMock.mockReset(); commitMock.mockReset(); });

const cbs = () => ({
  onImported: vi.fn(), onError: vi.fn(), onSuccess: vi.fn(), invalidate: vi.fn(),
});

function fixture(overrides: Partial<Awaited<ReturnType<typeof previewImport>>> = {}) {
  return {
    filename: 'x.csv', format: 'csv' as const, accountId: 3, totalRows: 1,
    newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
    duplicateRows: [],
    fuzzyDuplicateRows: [],
    ...overrides,
  };
}

describe('useImportPreview', () => {
  it('start() populates preview state with the returned ImportPreview', async () => {
    previewMock.mockResolvedValue(fixture());
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(result.current.preview?.filename).toBe('x.csv');
    expect(c.onError).not.toHaveBeenCalled();
  });

  it('confirm() forwards an empty skip list and invokes onImported with userSkipped', async () => {
    previewMock.mockResolvedValue(fixture());
    commitMock.mockResolvedValue({
      filename: 'x.csv', insertedCount: 1, dedupSkipped: 0, userSkipped: 0, totalLines: 1,
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm([]); });
    expect(commitMock).toHaveBeenCalledWith(file, { accountId: 3, skipParsedIndices: [] });
    expect(c.onImported).toHaveBeenCalledWith({
      filename: 'x.csv', inserted: 1, skipped: 0, userSkipped: 0, total: 1,
    });
    expect(c.invalidate).toHaveBeenCalled();
    expect(c.onSuccess).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it('confirm([7]) forwards the ticked parsedIndex to commitImport', async () => {
    previewMock.mockResolvedValue(fixture({
      totalRows: 4,
      newRows: [],
      duplicateRows: [],
      fuzzyDuplicateRows: [{
        row: { date: '2026-07-03', amount: '-25.31', rawLabel: 'CARREFOUR', memo: null },
        parsedIndex: 7,
        matches: [{ txId: 1, date: '2026-07-01', amount: '-25.30', rawLabel: 'CARREFOUR' }],
      }],
    }));
    commitMock.mockResolvedValue({
      filename: 'x.csv', insertedCount: 3, dedupSkipped: 0, userSkipped: 1, totalLines: 4,
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm([7]); });
    expect(commitMock).toHaveBeenCalledWith(file, { accountId: 3, skipParsedIndices: [7] });
    expect(c.onImported).toHaveBeenCalledWith({
      filename: 'x.csv', inserted: 3, skipped: 0, userSkipped: 1, total: 4,
    });
  });

  it('cancel() clears preview state without calling commitImport', async () => {
    previewMock.mockResolvedValue(fixture({ totalRows: 0, newRows: [], duplicateRows: [] }));
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    act(() => { result.current.cancel(); });
    expect(result.current.preview).toBeNull();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('preview error surfaces via onError and leaves preview null', async () => {
    previewMock.mockRejectedValue(new Error('boom'));
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(c.onError).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });
});
