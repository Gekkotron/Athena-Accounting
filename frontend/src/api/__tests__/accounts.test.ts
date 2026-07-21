import { describe, it, expect, afterEach, vi } from 'vitest';
import { mergeAccount } from '../accounts';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init),
  );
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { globalThis.fetch = originalFetch; });

describe('accounts API', () => {
  it('mergeAccount POSTs to /api/accounts/:sourceId/merge with the target id in the body', async () => {
    const merged = {
      transactionsMoved: 42,
      dedupCollisionsDropped: 1,
      transferGroupsCollapsed: 0,
      patternsMoved: 2,
      checkpointsMoved: 3,
      budgetsMoved: 0,
      importsMoved: 4,
      templatesMoved: 0,
      draftsMoved: 0,
      openingBalanceAdded: '0.00',
    };
    const spy = mockFetch(() => json({ ok: true, merged }));

    const result = await mergeAccount(11, 22);

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/accounts/11/merge');
    expect((init as RequestInit).method).toBe('POST');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ targetId: 22 });
    expect(result).toEqual(merged);
  });

  it('mergeAccount unwraps the { ok, merged } envelope and returns only merged', async () => {
    const merged = {
      transactionsMoved: 1,
      dedupCollisionsDropped: 0,
      transferGroupsCollapsed: 0,
      patternsMoved: 0,
      checkpointsMoved: 0,
      budgetsMoved: 0,
      importsMoved: 0,
      templatesMoved: 0,
      draftsMoved: 0,
      openingBalanceAdded: '10.00',
    };
    mockFetch(() => json({ ok: true, merged }));
    const result = await mergeAccount(1, 2);
    // No `ok` field leaks through.
    expect(result).not.toHaveProperty('ok');
    expect(result.openingBalanceAdded).toBe('10.00');
  });
});
