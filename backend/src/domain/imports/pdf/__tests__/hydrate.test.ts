import { describe, it, expect, vi, beforeEach } from 'vitest';

// text-extract lazy-loads pdfjs on first call and refuses non-PDF input.
// Mock it so the tests stay pure — the real extraction is exercised by
// the fullstack imports specs.
vi.mock('../text-extract.js', () => ({
  extractText: vi.fn(),
}));

// readPngDims validates the PNG signature + IHDR chunk; we drive it with a
// tiny crafted PNG buffer, but a mock keeps the test focused on hydrate's
// branching rather than PNG parsing (which has its own coverage).
vi.mock('../../ocr/index.js', () => ({
  readPngDims: vi.fn(),
}));

import { hydrateDraftPages, draftExpiredError } from '../hydrate.js';
import { extractText } from '../text-extract.js';
import { readPngDims } from '../../ocr/index.js';

const item = (pageIndex: number, str: string) => ({
  pageIndex, str,
  xLeft: 0, yTop: 0, width: 10, height: 10,
});

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('draftExpiredError', () => {
  it('returns an Error tagged code = "draft_expired"', () => {
    const err = draftExpiredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('draft_expired');
    expect((err as { code?: string }).code).toBe('draft_expired');
  });

  it('a fresh call returns a distinct Error instance (no shared mutation)', () => {
    const a = draftExpiredError();
    const b = draftExpiredError();
    expect(a).not.toBe(b);
  });
});

describe('hydrateDraftPages', () => {
  beforeEach(() => {
    vi.mocked(extractText).mockReset();
    vi.mocked(readPngDims).mockReset();
  });

  it('photo source → single page from PNG dims, items from stored text_items', async () => {
    vi.mocked(readPngDims).mockReturnValue({ widthPx: 800, heightPx: 600 });
    const stored = [item(0, 'photo-word-a'), item(0, 'photo-word-b')];
    const pages = await hydrateDraftPages({
      pdfBytes: b64('fake-png-bytes'),
      textItems: stored,
      sourceKind: 'photo',
      ocrStatus: 'ready',
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual({
      pageIndex: 0, widthPt: 800, heightPt: 600, items: stored,
    });
    // extractText must NOT be called on the photo path — pdfjs would
    // reject the PNG bytes.
    expect(vi.mocked(extractText)).not.toHaveBeenCalled();
  });

  it('photo source with no stored items → single page with items: []', async () => {
    vi.mocked(readPngDims).mockReturnValue({ widthPx: 100, heightPx: 200 });
    const pages = await hydrateDraftPages({
      pdfBytes: b64('fake-png'),
      textItems: null,
      sourceKind: 'photo',
      ocrStatus: 'pending',
    });
    expect(pages).toEqual([{
      pageIndex: 0, widthPt: 100, heightPt: 200, items: [],
    }]);
  });

  it('pdf source, ocr not ready → returns extractText output unchanged', async () => {
    const extracted = [
      { pageIndex: 0, widthPt: 595, heightPt: 842, items: [item(0, 'native')] },
    ];
    vi.mocked(extractText).mockResolvedValue(extracted);
    const pages = await hydrateDraftPages({
      pdfBytes: b64('%PDF-1.4 fake'),
      textItems: [item(0, 'stored-should-be-ignored')],
      sourceKind: 'pdf',
      ocrStatus: 'pending',
    });
    expect(pages).toEqual(extracted);
    expect(vi.mocked(readPngDims)).not.toHaveBeenCalled();
  });

  it('pdf source, ocr ready → overrides items per page from stored text_items', async () => {
    const extracted = [
      { pageIndex: 0, widthPt: 595, heightPt: 842, items: [item(0, 'native-pre-ocr')] },
      { pageIndex: 1, widthPt: 595, heightPt: 842, items: [] },
    ];
    vi.mocked(extractText).mockResolvedValue(extracted);
    const stored = [
      item(0, 'ocr-p0-word-1'),
      item(0, 'ocr-p0-word-2'),
      item(1, 'ocr-p1-word-1'),
    ];
    const pages = await hydrateDraftPages({
      pdfBytes: b64('%PDF-1.4 fake'),
      textItems: stored,
      sourceKind: 'pdf',
      ocrStatus: 'ready',
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.items.map((i) => i.str)).toEqual(['ocr-p0-word-1', 'ocr-p0-word-2']);
    expect(pages[1]?.items.map((i) => i.str)).toEqual(['ocr-p1-word-1']);
    // Dims are preserved from extractText — the override touches items only.
    expect(pages[0]?.widthPt).toBe(595);
    expect(pages[1]?.heightPt).toBe(842);
  });

  it('pdf source, ocr ready, no stored items for a given page → empty items on that page', async () => {
    vi.mocked(extractText).mockResolvedValue([
      { pageIndex: 0, widthPt: 500, heightPt: 700, items: [] },
      { pageIndex: 1, widthPt: 500, heightPt: 700, items: [] },
    ]);
    const stored = [item(1, 'only-page-1')];
    const pages = await hydrateDraftPages({
      pdfBytes: b64('%PDF'),
      textItems: stored,
      sourceKind: 'pdf',
      ocrStatus: 'ready',
    });
    expect(pages[0]?.items).toEqual([]);
    expect(pages[1]?.items).toEqual([item(1, 'only-page-1')]);
  });
});
