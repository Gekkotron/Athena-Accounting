import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider, getState } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';

interface TxResp { transactions: Array<{ id: number; categoryId: number | null; categorySource: string }>; pagination: { total: number } }

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

describe('demo write handlers', () => {
  it('POST /api/accounts creates and PATCH updates', async () => {
    const created = await api<{ account: { id: number; name: string } }>('/api/accounts', {
      method: 'POST',
      json: { name: 'Nouveau', currency: 'EUR', openingBalance: '100.00' },
    });
    expect(created.account.name).toBe('Nouveau');
    const patched = await api<{ account: { name: string } }>(`/api/accounts/${created.account.id}`, {
      method: 'PATCH',
      json: { name: 'Renommé' },
    });
    expect(patched.account.name).toBe('Renommé');
  });

  it('DELETE /api/accounts/:id removes the account + its transactions', async () => {
    const before = getState();
    const someAccId = before.accounts[0].id;
    const txCountBefore = before.transactions.length;
    const ownedTx = (before.transactions as Array<{ accountId: number }>).filter((t) => t.accountId === someAccId).length;
    await api(`/api/accounts/${someAccId}`, { method: 'DELETE' });
    const after = getState();
    expect(after.accounts.some((a) => a.id === someAccId)).toBe(false);
    expect(after.transactions.length).toBe(txCountBefore - ownedTx);
  });

  it('PATCH /api/transactions/:id inline category edit marks source manual', async () => {
    const list = await api<TxResp>('/api/transactions', { query: { limit: 5 } });
    const target = list.transactions.find((t) => t.categoryId !== SEED_META.categoryIds.Salaire)!;
    const patched = await api<{ transaction: { categoryId: number; categorySource: string } }>(
      `/api/transactions/${target.id}`,
      { method: 'PATCH', json: { categoryId: SEED_META.categoryIds.Salaire } },
    );
    expect(patched.transaction.categoryId).toBe(SEED_META.categoryIds.Salaire);
    expect(patched.transaction.categorySource).toBe('manual');
  });

  it('POST /api/tri/assign categorises + optionally creates a rule', async () => {
    const rulesBefore = getState().rules.length;
    const uncat = await api<{ groups: Array<{ normalized_label: string }> }>(
      '/api/tri/groups',
      { query: { limit: 5, offset: 0 } },
    );
    const label = uncat.groups[0].normalized_label;
    const r = await api<{ updated: number }>('/api/tri/assign', {
      method: 'POST',
      json: {
        normalizedLabels: [label],
        categoryId: SEED_META.categoryIds.Courses,
        createRule: true,
      },
    });
    expect(r.updated).toBeGreaterThan(0);
    expect(getState().rules.length).toBe(rulesBefore + 1);
  });

  it('POST /api/recategorize re-applies rules to non-manual tx', async () => {
    // Set the "Salaire" rule keyword to match SNCF, then recategorise.
    await api('/api/rules', {
      method: 'POST',
      json: {
        categoryId: SEED_META.categoryIds.Salaire,
        keyword: 'sncf voyages',
        signConstraint: 'negative',
        matchMode: 'substring',
        priority: 999,
      },
    });
    const r = await api<{ updated: number }>('/api/recategorize', { method: 'POST' });
    expect(r.updated).toBeGreaterThan(0);
  });

  it('PATCH /api/settings merges', async () => {
    const r = await api<{ settings: Record<string, unknown> }>('/api/settings', {
      method: 'PATCH',
      json: { locale: 'en' },
    });
    expect(r.settings.locale).toBe('en');
    expect(r.settings.currency).toBe('EUR');
  });

  it('POST /api/categories + DELETE nulls owning transactions', async () => {
    const create = await api<{ category: { id: number } }>('/api/categories', {
      method: 'POST',
      json: { name: 'Test', kind: 'expense' },
    });
    // Attach to a transaction, then delete category and verify null-out.
    const listResp = await api<TxResp>('/api/transactions', { query: { limit: 1 } });
    const txId = listResp.transactions[0].id;
    await api(`/api/transactions/${txId}`, {
      method: 'PATCH',
      json: { categoryId: create.category.id },
    });
    await api(`/api/categories/${create.category.id}`, { method: 'DELETE' });
    const afterList = await api<TxResp>('/api/transactions', { query: { limit: 500 } });
    expect(afterList.transactions.some((t) => t.categoryId === create.category.id)).toBe(false);
  });

  it('GET /api/backup/export returns the full state envelope', async () => {
    const dump = await api<{ v: number; accounts: unknown[] }>('/api/backup/export');
    expect(dump.v).toBe(2);
    expect(dump.accounts).toHaveLength(2);
  });
});
