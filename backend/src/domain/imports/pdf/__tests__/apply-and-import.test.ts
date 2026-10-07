import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TemplateZones } from '../zones.js';

// DB is faked with chainable stubs: select().from().where() resolves to the
// configured rows; delete().where() and insert().values().onConflictDoUpdate()
// are recorded so the tests can assert ordering and presence.
const state = vi.hoisted(() => ({
  draftRows: [] as unknown[],
  calls: [] as string[],
}));

vi.mock('../../../../db/client.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.draftRows }) }),
    delete: () => ({ where: async () => { state.calls.push('delete'); } }),
    insert: () => ({
      values: (v: unknown) => {
        state.calls.push('insert');
        (state as { inserted?: unknown }).inserted = v;
        return { onConflictDoUpdate: async () => { state.calls.push('upsert'); } };
      },
    }),
  },
}));

vi.mock('../template-apply.js', () => ({ applyTemplate: vi.fn() }));
vi.mock('../hydrate.js', async (orig) => ({
  ...(await orig<typeof import('../hydrate.js')>()),
  hydrateDraftPages: vi.fn(),
}));
vi.mock('../page-anchor.js', () => ({
  deriveAccountAnchor: vi.fn(),
  deriveOtherAccountAnchors: vi.fn(),
}));
vi.mock('../../import-service.js', () => ({ runImport: vi.fn() }));

import { applyTemplateAndImport } from '../apply-and-import.js';
import { applyTemplate } from '../template-apply.js';
import { hydrateDraftPages } from '../hydrate.js';
import { deriveAccountAnchor, deriveOtherAccountAnchors } from '../page-anchor.js';
import { runImport } from '../../import-service.js';

const rect = { page: 0, x: 0, y: 0, w: 100, h: 100 };
const zones = (extra: Partial<TemplateZones> = {}): TemplateZones => ({
  headerZone: rect,
  tableZone: rect,
  tableRepeatsPerPage: false,
  rowsStartY: 0,
  columns: [
    { xStart: 0, xEnd: 10, role: 'date' },
    { xStart: 10, xEnd: 20, role: 'description' },
    { xStart: 20, xEnd: 30, role: 'amountSigned' },
  ],
  ...extra,
});

const pdfB64 = Buffer.from('%PDF-1.7 fake').toString('base64');
const draft = (extra: Record<string, unknown> = {}) => ({
  id: 7, userId: 1, accountId: 3, fingerprint: 'fp',
  pdfBytes: pdfB64, textItems: null, sourceKind: 'pdf', ocrStatus: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...extra,
});

const importResult = { imported: 2 } as never;
const base = { draftId: 7, label: 'relevé juillet', userId: 1 };

beforeEach(() => {
  state.draftRows = [draft()];
  state.calls = [];
  vi.mocked(runImport).mockReset().mockResolvedValue(importResult);
  vi.mocked(applyTemplate).mockReset();
  vi.mocked(hydrateDraftPages).mockReset().mockResolvedValue([]);
  vi.mocked(deriveAccountAnchor).mockReset().mockReturnValue(null);
  vi.mocked(deriveOtherAccountAnchors).mockReset().mockReturnValue([]);
});

describe('applyTemplateAndImport — guards', () => {
  it('rejects invalid zones before touching the DB', async () => {
    await expect(applyTemplateAndImport({ ...base, zones: zones({ columns: [] }) }))
      .rejects.toThrow('zones: exactly one date column required');
    expect(runImport).not.toHaveBeenCalled();
  });

  it('missing draft → draft_expired', async () => {
    state.draftRows = [];
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toMatchObject({ code: 'draft_expired' });
  });

  it('draft owned by another user → draft_expired', async () => {
    state.draftRows = [draft({ userId: 99 })];
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toMatchObject({ code: 'draft_expired' });
    expect(runImport).not.toHaveBeenCalled();
  });

  it('expired draft is deleted then reported as draft_expired', async () => {
    state.draftRows = [draft({ expiresAt: new Date(Date.now() - 1000) })];
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toMatchObject({ code: 'draft_expired' });
    expect(state.calls).toEqual(['delete']);
  });

  it('non-PDF bytes for a pdf draft → descriptive error', async () => {
    state.draftRows = [draft({ pdfBytes: Buffer.from('PNG\x00junk').toString('base64') })];
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toThrow(/not a valid PDF/);
    expect(hydrateDraftPages).not.toHaveBeenCalled();
  });

  it('photo drafts skip the %PDF magic-byte check', async () => {
    state.draftRows = [draft({ sourceKind: 'photo', pdfBytes: Buffer.from('notpdf').toString('base64') })];
    vi.mocked(applyTemplate).mockReturnValue({ rows: [{ date: '2025-07-01', amount: '-1.00', rawLabel: 'X', memo: null, fitid: null }], skippedRows: [] });
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).resolves.toBeDefined();
  });
});

describe('applyTemplateAndImport — override rows', () => {
  it('imports reviewed rows with comma→dot amounts, skips zone parsing, deletes the draft', async () => {
    const res = await applyTemplateAndImport({
      ...base, zones: zones(),
      overrideRows: [{ date: '2025-07-01', label: 'CARTE', amount: '-12,50' }],
    });
    expect(applyTemplate).not.toHaveBeenCalled();
    expect(hydrateDraftPages).not.toHaveBeenCalled();
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({
      format: 'pdf', accountId: 3, userId: 1, filename: 'relevé juillet',
      prepared: [{ date: '2025-07-01', amount: '-12.50', rawLabel: 'CARTE', memo: null, fitid: null }],
    }));
    expect(state.calls).toEqual(['delete']);
    expect(res).toEqual({ result: importResult, skippedRows: [] });
  });

  it('an empty overrideRows array falls through to template parsing', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows: [], skippedRows: [] });
    await expect(applyTemplateAndImport({ ...base, zones: zones(), overrideRows: [] }))
      .rejects.toMatchObject({ code: 'template_yielded_no_rows' });
  });
});

describe('applyTemplateAndImport — template path', () => {
  const rows = [{ date: '2025-07-01', amount: '-1.00', rawLabel: 'X', memo: null, fitid: null }];

  it('zero rows → template_yielded_no_rows, nothing imported or persisted', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows: [], skippedRows: [] });
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toMatchObject({ code: 'template_yielded_no_rows' });
    expect(runImport).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });

  it('imports first, then upserts the template, then deletes the draft', async () => {
    const skipped = [{ rowText: 'r', reason: 'x' }];
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: skipped });
    const res = await applyTemplateAndImport({ ...base, zones: zones() });
    expect(state.calls).toEqual(['insert', 'upsert', 'delete']);
    expect(runImport).toHaveBeenCalledWith(expect.objectContaining({ prepared: rows, format: 'pdf' }));
    expect(res).toEqual({ result: importResult, skippedRows: skipped });
  });

  it('runImport failure leaves template and draft untouched', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: [] });
    vi.mocked(runImport).mockRejectedValue(new Error('boom'));
    await expect(applyTemplateAndImport({ ...base, zones: zones() })).rejects.toThrow('boom');
    expect(state.calls).toEqual([]);
  });

  it('stamps pageAnchor and otherAnchors from selectedPages when absent', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: [] });
    vi.mocked(deriveAccountAnchor).mockReturnValue('compte courant n° 12345');
    vi.mocked(deriveOtherAccountAnchors).mockReturnValue(['livret a n° 98765']);
    const z = zones({ selectedPages: [0] });
    await applyTemplateAndImport({ ...base, zones: z });
    expect(z.pageAnchor).toBe('compte courant n° 12345');
    expect(z.otherAnchors).toEqual(['livret a n° 98765']);
    expect(deriveOtherAccountAnchors).toHaveBeenCalledWith([], [0], 'compte courant n° 12345', 0);
  });

  it('does not overwrite an existing pageAnchor or otherAnchors', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: [] });
    const z = zones({ selectedPages: [0], pageAnchor: 'existing', otherAnchors: ['other'] });
    await applyTemplateAndImport({ ...base, zones: z });
    expect(deriveAccountAnchor).not.toHaveBeenCalled();
    expect(deriveOtherAccountAnchors).not.toHaveBeenCalled();
    expect(z.pageAnchor).toBe('existing');
    expect(z.otherAnchors).toEqual(['other']);
  });

  it('skips anchor derivation without selectedPages', async () => {
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: [] });
    await applyTemplateAndImport({ ...base, zones: zones() });
    expect(deriveAccountAnchor).not.toHaveBeenCalled();
  });

  it('accepts pdfBytes stored as a Buffer of base64 text', async () => {
    state.draftRows = [draft({ pdfBytes: Buffer.from(pdfB64, 'utf8') })];
    vi.mocked(applyTemplate).mockReturnValue({ rows, skippedRows: [] });
    await applyTemplateAndImport({ ...base, zones: zones() });
    expect(hydrateDraftPages).toHaveBeenCalledWith(expect.objectContaining({ pdfBytes: pdfB64 }));
  });
});
