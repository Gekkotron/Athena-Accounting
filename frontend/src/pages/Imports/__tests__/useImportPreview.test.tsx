import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportPreview } from '../useImportPreview';
import { pinLocale } from '../../../test/i18n';

// useImportPreview calls useTranslation('imports') for its error-message
// fallbacks. Preload the namespace for both locales so the hook never
// suspends, then pin the active language to French so the existing
// French-literal assertions (if any) keep matching real rendered text.
pinLocale('imports');

vi.mock('../../../api/imports', () => ({ previewImport: vi.fn() }));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, apiUpload: vi.fn() };
});
import { previewImport } from '../../../api/imports';
import { apiUpload } from '../../../api/client';
const previewMock = vi.mocked(previewImport);
const uploadMock = vi.mocked(apiUpload);

beforeEach(() => { previewMock.mockReset(); uploadMock.mockReset(); });

const cbs = () => ({ onImported: vi.fn(), onError: vi.fn(), onSuccess: vi.fn(), invalidate: vi.fn() });

describe('useImportPreview', () => {
  it('start() populates preview state with the returned ImportPreview', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-1.00', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    expect(result.current.preview?.filename).toBe('x.csv');
    expect(c.onError).not.toHaveBeenCalled();
  });

  it('confirm() calls apiUpload with the retained file and invokes onImported', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 1, newRows: [], duplicateRows: [],
    });
    uploadMock.mockResolvedValue({ filename: 'x.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1 });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    const file = new File(['x'], 'x.csv');
    await act(async () => { await result.current.start(file, 3); });
    await act(async () => { await result.current.confirm(); });
    expect(uploadMock).toHaveBeenCalledWith('/api/imports', file, { query: { accountId: 3 } });
    expect(c.onImported).toHaveBeenCalledWith({ filename: 'x.csv', inserted: 1, skipped: 0, total: 1 });
    expect(c.invalidate).toHaveBeenCalled();
    expect(c.onSuccess).toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it('cancel() clears preview state without calling apiUpload', async () => {
    previewMock.mockResolvedValue({
      filename: 'x.csv', format: 'csv', accountId: 3, totalRows: 0, newRows: [], duplicateRows: [],
    });
    const c = cbs();
    const { result } = renderHook(() => useImportPreview(c));
    await act(async () => { await result.current.start(new File(['x'], 'x.csv'), 3); });
    act(() => { result.current.cancel(); });
    expect(result.current.preview).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
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
