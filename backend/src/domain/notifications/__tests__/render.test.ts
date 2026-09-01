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
});
