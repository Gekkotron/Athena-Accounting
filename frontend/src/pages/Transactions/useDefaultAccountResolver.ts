import { useEffect, useState } from 'react';
import type { Account } from '../../api/types';
import type { TransactionsDefaultAccount } from '../../lib/settings';
import type { Filters } from './filters';

// Seed filters.accountId once, when /api/settings and /api/accounts are
// both ready and the URL did not already provide an accountId. See
// docs/superpowers/specs/2026-07-23-default-transactions-account-design.md
// for resolution rules.
export function useDefaultAccountResolver(args: {
  initialAccountId: number | undefined;
  settingsReady: boolean;
  accounts: Account[] | undefined;
  transactionsDefaultAccount: TransactionsDefaultAccount;
  setFilters: (updater: (f: Filters) => Filters) => void;
}) {
  const {
    initialAccountId,
    settingsReady,
    accounts,
    transactionsDefaultAccount,
    setFilters,
  } = args;
  const [defaultResolved, setDefaultResolved] = useState(initialAccountId != null);

  useEffect(() => {
    if (defaultResolved) return;
    if (!settingsReady || !accounts) return;
    const pref = transactionsDefaultAccount;
    let resolved: number | undefined;
    if (pref === 'all') {
      resolved = undefined;
    } else if (pref === 'first-checking') {
      const firstChecking = [...accounts]
        .filter((a) => a.type === 'checking')
        .sort((a, b) => a.id - b.id)[0];
      resolved = firstChecking?.id;
    } else if (typeof pref === 'number') {
      resolved = accounts.some((a) => a.id === pref) ? pref : undefined;
    }
    if (resolved != null) {
      setFilters((f) => ({ ...f, accountId: resolved }));
    }
    setDefaultResolved(true);
  }, [defaultResolved, settingsReady, accounts, transactionsDefaultAccount, setFilters]);

  return defaultResolved;
}
