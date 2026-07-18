import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  submitPdf,
  submitZones,
  listPdfTemplates,
  renamePdfTemplate,
  deletePdfTemplate,
  type TemplateZones,
} from '../pdf-templates';
import { isDemoStubError } from '../errorMessage';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init),
  );
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {});
afterEach(() => { globalThis.fetch = originalFetch; });

const sampleZones: TemplateZones = {
  headerZone: { page: 0, x: 0, y: 0, w: 100, h: 20 },
  tableZone: { page: 0, x: 0, y: 30, w: 100, h: 200 },
  tableRepeatsPerPage: true,
  columns: [{ xStart: 0, xEnd: 50, role: 'date' }],
  rowsStartY: 40,
};

describe('submitPdf', () => {
  it('POSTs multipart form data with the file, includes accountId in the URL', async () => {
    const spy = mockFetch(() => json({ kind: 'imported', result: { fileImportId: 1, insertedCount: 3, dedupSkipped: 0, totalLines: 3 }, skippedRows: [] }));
    const res = await submitPdf(new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }), 42);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toContain('/api/imports?accountId=42');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(res.kind).toBe('imported');
  });

  it('throws with the server error message when the response is not ok', async () => {
    mockFetch(() => json({ error: 'upload failed', message: 'bad pdf' }, 400));
    await expect(submitPdf(new File(['x'], 'a.pdf'), 1)).rejects.toMatchObject({
      message: expect.stringContaining('upload failed'),
      status: 400,
    });
  });
});

describe('submitZones', () => {
  it('POSTs JSON body with draftId + label + zones and returns { kind: imported }', async () => {
    const spy = mockFetch(() => json({ result: { fileImportId: 5, insertedCount: 2, dedupSkipped: 0, totalLines: 2 }, skippedRows: [] }));
    const res = await submitZones(9, 'BNP', sampleZones);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/imports/pdf/templates');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ draftId: 9, label: 'BNP', zones: sampleZones });
    expect(res.kind).toBe('imported');
    expect(res.result.insertedCount).toBe(2);
  });

  it('throws on non-ok, including the server-provided detail', async () => {
    mockFetch(() => json({ error: 'apply failed', message: 'zone out of range' }, 422));
    await expect(submitZones(9, 'x', sampleZones)).rejects.toMatchObject({
      message: 'apply failed: zone out of range',
      status: 422,
    });
  });
});

describe('template CRUD', () => {
  it('listPdfTemplates unwraps the templates field', async () => {
    mockFetch(() => json({ templates: [{ id: 1, fingerprint: 'a', label: 'x', source: 'interactive', createdAt: '', updatedAt: '' }] }));
    const rows = await listPdfTemplates();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('x');
  });

  it('renamePdfTemplate sends { label } as JSON PUT', async () => {
    const spy = mockFetch(() => json({}));
    await renamePdfTemplate(7, 'NewName');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/pdf-templates/7');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ label: 'NewName' });
  });

  it('deletePdfTemplate DELETEs the given id', async () => {
    const spy = mockFetch(() => json({}));
    await deletePdfTemplate(3);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/pdf-templates/3');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('rename/delete surface backend error text', async () => {
    mockFetch(() => json({ error: 'rename failed', message: 'label taken' }, 409));
    await expect(renamePdfTemplate(1, 'x')).rejects.toMatchObject({
      message: 'rename failed: label taken',
      status: 409,
    });
  });
});

describe('demo-mode propagation', () => {
  // Matches the Response shape produced by the demo fetch patch in
  // api/demo/index.ts when a stubbed /api/* path is hit — a 501 with
  // { error, demoStub: true, path } in the JSON body. If failure() drops
  // demoStub, ErrorState can't route to DemoUnavailableState and the
  // PdfTemplatesPanel falls back to a bare "Couldn't load templates" card.
  it('listPdfTemplates propagates demoStub so isDemoStubError() matches', async () => {
    mockFetch(() =>
      json(
        {
          error: "Cette fonctionnalité n'est pas disponible dans la démo. Installez Athena pour l'utiliser.",
          demoStub: true,
          path: '/api/pdf-templates',
        },
        501,
      ),
    );
    let caught: unknown = null;
    try { await listPdfTemplates(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(isDemoStubError(caught)).toBe(true);
  });

  it('listPdfTemplates propagates demoMissingHandler for unregistered demo paths', async () => {
    mockFetch(() =>
      json({ error: 'Demo: no handler for GET /api/pdf-templates', demoMissingHandler: true }, 501),
    );
    let caught: unknown = null;
    try { await listPdfTemplates(); } catch (e) { caught = e; }
    expect(isDemoStubError(caught)).toBe(true);
  });
});
