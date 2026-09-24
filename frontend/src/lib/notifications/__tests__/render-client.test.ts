import { describe, it, expect } from 'vitest';
import { renderTitle, renderBody, renderFullDetail } from '../render-client';
import type { NotificationPayload } from '../../../../../shared/api-contracts';

const OPEN = { hideAmount: false, hideMerchant: false };
const HIDDEN = { hideAmount: true, hideMerchant: true };

describe('renderTitle — one per NotificationKind', () => {
  it.each<[NotificationPayload, string]>([
    [{ kind: 'big_transaction', single: { txId: 1, accountId: 1, amount: -100, merchant: null } }, 'Big transaction'],
    [{ kind: 'account_low', accountId: 1, balance: 5, floor: 100 }, 'Account balance low'],
    [{ kind: 'envelope_exceeded', categoryId: 1, envelope: 100, spent: 150, month: '2026-09' }, 'Budget exceeded'],
    [{ kind: 'bank_sync_failed', accountId: 1, reason: 'auth' }, 'Bank sync failed'],
    [{ kind: 'test' }, 'Test notification'],
  ])('kind=%o → %s', (payload, expected) => {
    expect(renderTitle(payload, OPEN)).toBe(expected);
  });
});

describe('renderBody — big_transaction', () => {
  it('single, open privacy: shows amount and merchant', () => {
    const body = renderBody(
      { kind: 'big_transaction', single: { txId: 1, accountId: 4, accountName: 'Compte courant', amount: -123.45, merchant: 'SNCF' } },
      OPEN,
    );
    expect(body).toContain('Compte courant');
    expect(body).toContain('SNCF');
    // French-locale currency formatting varies by node/icu; assert on the digits.
    expect(body).toMatch(/123,45/);
  });

  it('single, hideAmount=true: amount omitted, merchant still there', () => {
    const body = renderBody(
      { kind: 'big_transaction', single: { txId: 1, accountId: 4, amount: -123.45, merchant: 'Fnac' } },
      { hideAmount: true, hideMerchant: false },
    );
    expect(body).not.toMatch(/123,45/);
    expect(body).toContain('Fnac');
  });

  it('single, hideMerchant=true: merchant omitted, amount still there', () => {
    const body = renderBody(
      { kind: 'big_transaction', single: { txId: 1, accountId: 4, amount: -20, merchant: 'Fnac' } },
      { hideAmount: false, hideMerchant: true },
    );
    expect(body).not.toContain('Fnac');
  });

  it('single, everything hidden AND merchant is null → fallback string', () => {
    const body = renderBody(
      { kind: 'big_transaction', single: { txId: 1, accountId: 4, amount: -50, merchant: null } },
      HIDDEN,
    );
    // Empty parts trim to "on account #4"; the .trim() || fallback only
    // hits when the pre-trim string is entirely whitespace.
    expect(body).toBe('on account #4');
  });

  it('summary, open privacy: shows count + total', () => {
    const body = renderBody(
      { kind: 'big_transaction', summary: { accountId: 4, accountName: 'Livret', count: 3, total: -500 } },
      OPEN,
    );
    expect(body).toContain('3 big transactions');
    expect(body).toContain('Livret');
    expect(body).toMatch(/500/);
  });

  it('summary, hideAmount=true: total omitted', () => {
    const body = renderBody(
      { kind: 'big_transaction', summary: { accountId: 4, count: 3, total: -500 } },
      { hideAmount: true, hideMerchant: false },
    );
    expect(body).not.toMatch(/500,00/);
    expect(body).toContain('account #4');
  });
});

describe('renderBody — remaining kinds', () => {
  it('account_low, open privacy: shows balance', () => {
    const body = renderBody(
      { kind: 'account_low', accountId: 7, accountName: 'PEL', balance: 42, floor: 100 },
      OPEN,
    );
    expect(body).toContain('PEL');
    expect(body).toContain('dipped below');
    expect(body).toMatch(/42/);
  });

  it('account_low, hideAmount=true: balance omitted, account named', () => {
    const body = renderBody(
      { kind: 'account_low', accountId: 7, balance: 42, floor: 100 },
      HIDDEN,
    );
    expect(body).not.toMatch(/42,00/);
    expect(body).toContain('account #7');
  });

  it('envelope_exceeded shows month + optional money', () => {
    const open = renderBody(
      { kind: 'envelope_exceeded', categoryId: 3, categoryName: 'Courses', envelope: 200, spent: 250, month: '2026-09' },
      OPEN,
    );
    expect(open).toContain('Courses');
    expect(open).toContain('2026-09');
    expect(open).toMatch(/250/);

    const hidden = renderBody(
      { kind: 'envelope_exceeded', categoryId: 3, envelope: 200, spent: 250, month: '2026-09' },
      HIDDEN,
    );
    expect(hidden).toContain('category #3');
    expect(hidden).not.toMatch(/250,00/);
  });

  it('bank_sync_failed shows reason (privacy irrelevant)', () => {
    const body = renderBody(
      { kind: 'bank_sync_failed', accountId: 9, accountName: 'BoursoBank', reason: 'auth_expired' },
      OPEN,
    );
    expect(body).toContain('BoursoBank');
    expect(body).toContain('auth_expired');
  });

  it('test kind → fixed body string', () => {
    expect(renderBody({ kind: 'test' }, OPEN)).toBe(
      'This is a test — if you see it, the pipeline works.',
    );
  });
});

describe('renderFullDetail', () => {
  it('always renders with open privacy (both hideAmount + hideMerchant false)', () => {
    const p: NotificationPayload = {
      kind: 'big_transaction',
      single: { txId: 1, accountId: 4, accountName: 'X', amount: -99, merchant: 'M' },
    };
    const detail = renderFullDetail(p);
    expect(detail.title).toBe('Big transaction');
    expect(detail.body).toContain('X');
    expect(detail.body).toContain('M');
    expect(detail.body).toMatch(/99/);
  });
});
