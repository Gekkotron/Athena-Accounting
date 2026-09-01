import { describe, it, expect } from 'vitest';
import { renderTitle, renderBody, renderFullDetail } from '../render.js';

const privacyOn  = { hideAmount: true,  hideMerchant: true };
const privacyOff = { hideAmount: false, hideMerchant: false };

describe('render', () => {
  it('big_transaction summary hides amount', () => {
    const p = { kind: 'big_transaction' as const, summary: { accountId: 1, count: 4, total: 1200 } };
    expect(renderBody(p, privacyOn)).not.toMatch(/1[\s, ]200|1200/);
    expect(renderBody(p, privacyOff)).toMatch(/1[\s, ]200|1200/);
  });

  it('big_transaction single hides merchant', () => {
    const p = { kind: 'big_transaction' as const, single: { txId: 2, accountId: 1, amount: 842.3, merchant: 'Carrefour' } };
    expect(renderBody(p, privacyOn)).not.toContain('Carrefour');
    expect(renderBody(p, privacyOff)).toContain('Carrefour');
  });

  it('inbox rendering always shows full detail', () => {
    const p = { kind: 'big_transaction' as const, single: { txId: 2, accountId: 1, amount: 842.3, merchant: 'Carrefour' } };
    const { body } = renderFullDetail(p);
    expect(body).toContain('Carrefour');
    expect(body).toMatch(/842/);
  });

  it('prefers accountName over the id fallback', () => {
    const single = { kind: 'big_transaction' as const, single: { txId: 2, accountId: 42, accountName: 'Compte Courant', amount: 100, merchant: null } };
    expect(renderBody(single, privacyOff)).toContain('on Compte Courant');
    expect(renderBody(single, privacyOff)).not.toContain('#42');

    const low = { kind: 'account_low' as const, accountId: 7, accountName: 'Épargne', balance: 12, floor: 100 };
    expect(renderBody(low, privacyOff)).toContain('Épargne dipped');
    expect(renderBody(low, privacyOff)).not.toContain('#7');

    const bank = { kind: 'bank_sync_failed' as const, accountId: 9, accountName: 'BoursoBank', reason: 'timeout' };
    expect(renderBody(bank, privacyOff)).toContain('Sync failed for BoursoBank');
    expect(renderBody(bank, privacyOff)).not.toContain('#9');
  });

  it('prefers categoryName over the id fallback', () => {
    const env = {
      kind: 'envelope_exceeded' as const,
      categoryId: 5,
      categoryName: 'Alimentation',
      envelope: 200,
      spent: 250,
      month: '2026-09',
    };
    expect(renderBody(env, privacyOff)).toContain('Alimentation over budget');
    expect(renderBody(env, privacyOff)).not.toContain('#5');
  });

  it('falls back to `#id` on legacy payloads that lack a name', () => {
    // Rows persisted before payload enrichment existed should still render.
    const p = { kind: 'account_low' as const, accountId: 3, balance: 10, floor: 100 };
    expect(renderBody(p, privacyOff)).toContain('account #3 dipped');
  });
});
