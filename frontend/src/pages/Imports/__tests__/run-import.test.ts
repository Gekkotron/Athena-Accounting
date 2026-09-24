import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../api/client', () => ({
  apiUpload: vi.fn(),
}));

vi.mock('../../../api/pdf-templates', () => ({
  submitPdf: vi.fn(),
  submitPhoto: vi.fn(),
}));

vi.mock('../../../api/errorMessage', () => ({
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { isPdfFile, isImageFile, isOfxCsvFile, runOne } from '../run-import';
import { apiUpload } from '../../../api/client';
import { submitPdf, submitPhoto } from '../../../api/pdf-templates';

// The English fallback is enough for these tests — we mock errorMessage to
// pass err.message through, and the accountRequiredForPdf branch just
// needs SOME string back.
const t = ((key: string) => `t:${key}`) as unknown as import('i18next').TFunction;

const file = (name: string) =>
  new File(['contents'], name, { type: 'application/octet-stream' });

const importedResponse = (inserted: number, skipped: number) => ({
  kind: 'imported' as const,
  result: { fileImportId: 1, insertedCount: inserted, dedupSkipped: skipped, totalLines: inserted + skipped },
  skippedRows: [],
});

const needsTemplateResponse = (reason: 'no_text_layer' | 'low_confidence' | 'template_stale') => ({
  kind: 'needs_template' as const,
  draftId: 42,
  fingerprint: 'fp',
  pages: [],
  textItems: [],
  suggestedZones: null,
  reason,
  sourceKind: 'pdf' as const,
  ocrStatus: 'not_needed' as const,
  ocrTotal: 0,
});

describe('isPdfFile / isImageFile / isOfxCsvFile', () => {
  it.each([
    ['x.pdf', true], ['X.PDF', true], ['a.Pdf', true],
    ['x.png', false], ['x.txt', false], ['pdf', false],
  ])('isPdfFile(%s) = %s', (name, expected) => {
    expect(isPdfFile(name)).toBe(expected);
  });

  it.each([
    ['a.png', true], ['a.jpg', true], ['a.JPEG', true],
    ['a.webp', true], ['a.HEIC', true],
    ['a.pdf', false], ['a.gif', false], ['a', false],
  ])('isImageFile(%s) = %s', (name, expected) => {
    expect(isImageFile(name)).toBe(expected);
  });

  it.each([
    ['a.ofx', true], ['a.qfx', true], ['a.csv', true], ['A.CSV', true],
    ['a.pdf', false], ['a.png', false], ['csv', false],
  ])('isOfxCsvFile(%s) = %s', (name, expected) => {
    expect(isOfxCsvFile(name)).toBe(expected);
  });
});

describe('runOne', () => {
  beforeEach(() => {
    vi.mocked(apiUpload).mockReset();
    vi.mocked(submitPdf).mockReset();
    vi.mocked(submitPhoto).mockReset();
  });

  it('pdf + no accountId → error message, no upload', async () => {
    const r = await runOne(file('bank.pdf'), '', t);
    expect(r).toEqual({ ok: false, message: 't:errors.accountRequiredForPdf' });
    expect(vi.mocked(submitPdf)).not.toHaveBeenCalled();
  });

  it('pdf import succeeds first try → ok with counts', async () => {
    vi.mocked(submitPdf).mockResolvedValue(importedResponse(7, 2));
    const r = await runOne(file('bank.pdf'), 3, t);
    expect(r).toEqual({ ok: true, inserted: 7, skipped: 2 });
    expect(vi.mocked(submitPhoto)).not.toHaveBeenCalled();
  });

  it('pdf falls back to photo (OCR) when reason=no_text_layer', async () => {
    vi.mocked(submitPdf).mockResolvedValue(needsTemplateResponse('no_text_layer'));
    vi.mocked(submitPhoto).mockResolvedValue(importedResponse(4, 0));
    const r = await runOne(file('scanned.pdf'), 3, t);
    expect(r).toEqual({ ok: true, inserted: 4, skipped: 0 });
    expect(vi.mocked(submitPhoto)).toHaveBeenCalledOnce();
  });

  it('pdf returns needs_template for a non-no_text_layer reason → returned as needsTemplate', async () => {
    const ntpl = needsTemplateResponse('low_confidence');
    vi.mocked(submitPdf).mockResolvedValue(ntpl);
    const r = await runOne(file('foo.pdf'), 3, t);
    expect(r).toEqual({ ok: false, needsTemplate: ntpl });
    expect(vi.mocked(submitPhoto)).not.toHaveBeenCalled();
  });

  it('pdf → OCR fallback also returns needs_template → returned as needsTemplate', async () => {
    const ntplA = needsTemplateResponse('no_text_layer');
    const ntplB = needsTemplateResponse('low_confidence');
    vi.mocked(submitPdf).mockResolvedValue(ntplA);
    vi.mocked(submitPhoto).mockResolvedValue(ntplB);
    const r = await runOne(file('foo.pdf'), 3, t);
    expect(r).toEqual({ ok: false, needsTemplate: ntplB });
  });

  it('image file + no accountId → error, no upload', async () => {
    const r = await runOne(file('receipt.jpg'), '', t);
    expect(r).toEqual({ ok: false, message: 't:errors.accountRequiredForPdf' });
    expect(vi.mocked(submitPhoto)).not.toHaveBeenCalled();
  });

  it('image import succeeds → ok', async () => {
    vi.mocked(submitPhoto).mockResolvedValue(importedResponse(3, 1));
    const r = await runOne(file('receipt.png'), 5, t);
    expect(r).toEqual({ ok: true, inserted: 3, skipped: 1 });
  });

  it('image import returns needs_template → needsTemplate result', async () => {
    const ntpl = needsTemplateResponse('low_confidence');
    vi.mocked(submitPhoto).mockResolvedValue(ntpl);
    const r = await runOne(file('receipt.png'), 5, t);
    expect(r).toEqual({ ok: false, needsTemplate: ntpl });
  });

  it('ofx/csv file → apiUpload path with accountId in query', async () => {
    vi.mocked(apiUpload).mockResolvedValue({
      filename: 'x.ofx', insertedCount: 12, dedupSkipped: 4, totalLines: 16,
    });
    const r = await runOne(file('bank.ofx'), 9, t);
    expect(r).toEqual({ ok: true, inserted: 12, skipped: 4 });
    expect(vi.mocked(apiUpload)).toHaveBeenCalledWith(
      '/api/imports',
      expect.any(File),
      { query: { accountId: 9 } },
    );
  });

  it('csv without accountId → apiUpload called without a query', async () => {
    vi.mocked(apiUpload).mockResolvedValue({
      filename: 'x.csv', insertedCount: 1, dedupSkipped: 0, totalLines: 1,
    });
    await runOne(file('any.csv'), '', t);
    expect(vi.mocked(apiUpload)).toHaveBeenCalledWith(
      '/api/imports',
      expect.any(File),
      { query: undefined },
    );
  });

  it('a thrown error in any path → { ok:false, message } via errorMessage', async () => {
    vi.mocked(submitPdf).mockRejectedValue(new Error('network exploded'));
    const r = await runOne(file('bank.pdf'), 3, t);
    expect(r).toEqual({ ok: false, message: 'network exploded' });
  });
});
