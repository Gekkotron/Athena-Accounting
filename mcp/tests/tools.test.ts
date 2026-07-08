import { describe, it, expect } from 'vitest';
import { TOOL_SPECS, callTool } from '../src/tools.js';

// A fake client records the (op, args) each tool forwards.
function fakeClient() {
  const calls: Array<{ op: string; args: any }> = [];
  return { calls, rpc: async (op: string, args: any) => { calls.push({ op, args }); return { ok: true }; } };
}

describe('mcp tools', () => {
  it('exposes exactly the six tools mapped to ops', () => {
    expect(TOOL_SPECS.map((t) => t.name).sort()).toEqual(
      ['create_transaction', 'delete_transaction', 'list_accounts', 'list_categories', 'search_transactions', 'update_transaction'],
    );
    for (const t of TOOL_SPECS) expect(t.op).toBe(t.name);
  });

  it('callTool forwards op + args to the client', async () => {
    const c = fakeClient();
    await callTool(c as any, 'create_transaction', { accountId: 1, date: '2026-01-01', amount: '-1.00', rawLabel: 'x' });
    expect(c.calls[0]).toEqual({ op: 'create_transaction', args: { accountId: 1, date: '2026-01-01', amount: '-1.00', rawLabel: 'x' } });
  });

  it('delete_transaction forwards the id', async () => {
    const c = fakeClient();
    await callTool(c as any, 'delete_transaction', { id: 42 });
    expect(c.calls[0]).toEqual({ op: 'delete_transaction', args: { id: 42 } });
  });
});
