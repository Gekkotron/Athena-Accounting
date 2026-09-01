// Client-side mirror of backend/src/domain/notifications/render.ts — keep in
// sync by hand when either side changes.
import type { NotificationPayload } from '../../../../shared/api-contracts.js';

type Privacy = { hideAmount: boolean; hideMerchant: boolean };

const amount = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export function renderTitle(p: NotificationPayload, _priv: Privacy): string {
  switch (p.kind) {
    case 'big_transaction':      return 'Big transaction';
    case 'account_low':          return 'Account balance low';
    case 'envelope_exceeded':    return 'Budget exceeded';
    case 'bank_sync_failed':     return 'Bank sync failed';
    case 'test':                 return 'Test notification';
  }
}

export function renderBody(p: NotificationPayload, priv: Privacy): string {
  switch (p.kind) {
    case 'big_transaction': {
      if ('summary' in p) {
        const total = priv.hideAmount ? '' : ` (${amount(p.summary.total)})`;
        return `${p.summary.count} big transactions on account #${p.summary.accountId}${total}`;
      }
      const merchant = !priv.hideMerchant && p.single.merchant ? ` at ${p.single.merchant}` : '';
      const money    = priv.hideAmount ? '' : `${amount(p.single.amount)} `;
      return `${money}on account #${p.single.accountId}${merchant}`.trim() || 'A big transaction was recorded';
    }
    case 'account_low': {
      const balance = priv.hideAmount ? '' : ` (${amount(p.balance)})`;
      return `Account #${p.accountId} dipped below its floor${balance}`;
    }
    case 'envelope_exceeded': {
      const money = priv.hideAmount ? '' : ` — ${amount(p.spent)} of ${amount(p.envelope)}`;
      return `Category #${p.categoryId} over budget for ${p.month}${money}`;
    }
    case 'bank_sync_failed':
      return `Sync failed for account #${p.accountId}: ${p.reason}`;
    case 'test':
      return 'This is a test — if you see it, the pipeline works.';
  }
}

export function renderFullDetail(p: NotificationPayload): { title: string; body: string } {
  return {
    title: renderTitle(p, { hideAmount: false, hideMerchant: false }),
    body:  renderBody (p, { hideAmount: false, hideMerchant: false }),
  };
}
