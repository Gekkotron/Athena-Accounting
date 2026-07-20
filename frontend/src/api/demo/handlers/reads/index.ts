// GET handlers for the browser-only demo. Each group registers itself on
// the shared handler registry; the composer just calls each in turn.
// Response shapes mirror what the backend returns — the frontend can't
// tell it's talking to a fake.

import { registerSimpleHandlers } from './simple';
import { registerAccountsHandlers } from './accounts';
import { registerTransactionsHandlers } from './transactions';
import { registerReportsHandlers } from './reports';
import { registerTriHandlers } from './tri';
import { registerRecurringHandlers } from './recurring';

export function registerReadHandlers(): void {
  registerSimpleHandlers();
  registerAccountsHandlers();
  registerTransactionsHandlers();
  registerReportsHandlers();
  registerTriHandlers();
  registerRecurringHandlers();
}
