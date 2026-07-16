import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewImport, type ImportPreview } from '../imports';

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return { ...actual, apiUpload: vi.fn() };
});
import { apiUpload } from '../client';
const uploadMock = vi.mocked(apiUpload);

beforeEach(() => uploadMock.mockReset());

describe('previewImport', () => {
  it('posts the file to /api/imports/preview with the accountId query when given', async () => {
    const payload: ImportPreview = {
      filename: 'x.csv',
      format: 'csv',
      accountId: 7,
      totalRows: 1,
      newRows: [{ date: '2026-06-15', amount: '-3.50', rawLabel: 'X', memo: null }],
      duplicateRows: [],
    };
    uploadMock.mockResolvedValue(payload);
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    const result = await previewImport(file, 7);
    expect(uploadMock).toHaveBeenCalledWith('/api/imports/preview', file, { query: { accountId: 7 } });
    expect(result).toEqual(payload);
  });

  it('omits the accountId query when accountId is undefined', async () => {
    uploadMock.mockResolvedValue({
      filename: 'y.csv', format: 'csv', accountId: 3, totalRows: 0,
      newRows: [], duplicateRows: [],
    });
    const file = new File(['x'], 'y.csv', { type: 'text/csv' });
    await previewImport(file);
    expect(uploadMock).toHaveBeenCalledWith('/api/imports/preview', file, { query: undefined });
  });
});
