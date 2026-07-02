import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, apiUpload, ApiError } from '../client';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(handler);
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

beforeEach(() => {
  // window.location.origin defaults to http://localhost:3000 in jsdom.
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api()', () => {
  it('GETs a relative path and parses JSON', async () => {
    const fetchMock = mockFetch(() => jsonRes({ hello: 'world' }));
    const data = await api<{ hello: string }>('/api/things');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/things');
    expect((init as RequestInit).credentials).toBe('include');
    expect(data).toEqual({ hello: 'world' });
  });

  it('serializes the query object into the URL, skipping undefined/null/empty', async () => {
    const fetchMock = mockFetch(() => jsonRes({}));
    await api('/api/things', { query: { a: 1, b: 'x', c: undefined, d: null, e: '' } });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/things?a=1&b=x');
  });

  it('sends the json option as an application/json POST body', async () => {
    const fetchMock = mockFetch(() => jsonRes({ ok: true }));
    await api('/api/things', { method: 'POST', json: { name: 'ada' } });
    const [, init] = fetchMock.mock.calls[0]!;
    const h = new Headers((init as RequestInit).headers);
    expect(h.get('Content-Type')).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'ada' }));
    expect((init as RequestInit).method).toBe('POST');
  });

  it('throws ApiError with the server-provided error message on 4xx', async () => {
    mockFetch(() => jsonRes({ error: 'not found' }, 404));
    await expect(api('/api/things')).rejects.toBeInstanceOf(ApiError);
    try {
      await api('/api/things');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).message).toBe('not found');
      expect((e as ApiError).data).toEqual({ error: 'not found' });
    }
  });

  it('falls back to "HTTP <status>" when the server response has no error field', async () => {
    mockFetch(() => jsonRes({}, 500));
    await expect(api('/api/things')).rejects.toMatchObject({ message: 'HTTP 500', status: 500 });
  });

  it('returns null on an OK empty body', async () => {
    mockFetch(() => new Response('', { status: 200 }));
    const data = await api('/api/void');
    expect(data).toBeNull();
  });

  it('returns the raw text as data when the body is not valid JSON', async () => {
    mockFetch(() => new Response('plain text ok', { status: 200 }));
    const data = await api<string>('/api/text');
    expect(data).toBe('plain text ok');
  });
});

describe('apiUpload()', () => {
  it('POSTs a FormData body containing the file under the "file" key', async () => {
    const fetchMock = mockFetch(() => jsonRes({ ok: true }));
    const file = new File(['hi'], 'a.csv', { type: 'text/csv' });
    await apiUpload('/api/imports', file);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/imports');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const returned = body.get('file');
    expect(returned).toBeInstanceOf(File);
    expect((returned as File).name).toBe('a.csv');
  });

  it('appends non-null query params to the URL', async () => {
    const fetchMock = mockFetch(() => jsonRes({}));
    await apiUpload('/api/imports', new File(['x'], 'x.csv'), {
      query: { accountId: 3, blank: '', missing: undefined },
    });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/imports?accountId=3');
  });

  it('throws ApiError on a non-ok response, preserving the server error text', async () => {
    mockFetch(() => jsonRes({ error: 'account not found' }, 400));
    await expect(apiUpload('/api/imports', new File(['x'], 'x.csv'))).rejects.toMatchObject({
      status: 400,
      message: 'account not found',
    });
  });
});
