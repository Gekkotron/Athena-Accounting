// Write-side handlers for the browser-only demo. Every mutation goes
// through store.setState() so the change persists to localStorage and
// notifies subscribers. Registration composes per-resource group modules.

import { registerAccountsWriteHandlers } from './accounts';
import { registerTransactionsWriteHandlers } from './transactions';
import { registerCategoriesWriteHandlers } from './categories';
import { registerRulesWriteHandlers } from './rules';
import { registerBudgetsWriteHandlers } from './budgets';
import { registerTriWriteHandlers } from './tri';
import { registerSettingsWriteHandlers } from './settings';
import { registerRecurringWriteHandlers } from './recurring';

export function registerWriteHandlers(): void {
  registerAccountsWriteHandlers();
  registerTransactionsWriteHandlers();
  registerCategoriesWriteHandlers();
  registerRulesWriteHandlers();
  registerBudgetsWriteHandlers();
  registerTriWriteHandlers();
  registerSettingsWriteHandlers();
  registerRecurringWriteHandlers();
}
