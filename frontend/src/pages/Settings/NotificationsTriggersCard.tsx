import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';
import type { NotificationPrefs, NotificationPrefsPatch } from '../../lib/settings';
import { parseDecimal } from '../../lib/format';

// Blur-committed per-account amount field. Empty input clears the entry
// for that account rather than storing 0.
function AccountAmountRow({
  account,
  value,
  onCommit,
}: {
  account: Account;
  value: number | undefined;
  onCommit: (next: number | null) => void;
}): JSX.Element {
  const toDraft = (v: number | undefined) => (v == null ? '' : String(v).replace('.', ','));
  const [draft, setDraft] = useState(toDraft(value));
  useEffect(() => { setDraft(toDraft(value)); }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      if (value != null) onCommit(null);
      return;
    }
    const parsed = parseDecimal(draft);
    if (parsed == null) { setDraft(toDraft(value)); return; }
    const n = Number(parsed);
    if (n !== value) onCommit(n);
  };

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-ink-300">{account.name}</span>
      <input
        type="text"
        inputMode="decimal"
        className="input !py-1 !px-2 w-28 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        aria-label={account.name}
      />
    </div>
  );
}

function withAmount(
  current: Record<string, number>,
  accountId: number,
  next: number | null,
): Record<string, number> {
  const copy = { ...current };
  if (next == null) delete copy[String(accountId)];
  else copy[String(accountId)] = next;
  return copy;
}

export function NotificationsTriggersCard({
  prefs,
  accounts,
  onPatch,
}: {
  prefs: NotificationPrefs;
  accounts: Account[];
  onPatch: (p: NotificationPrefsPatch) => void;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const { triggers } = prefs;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-ink-800 p-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={triggers.bigTransaction.enabled}
            onChange={(e) => onPatch({ triggers: { bigTransaction: { enabled: e.target.checked } } })}
          />
          {t('settings.notifications.triggers.bigTransaction.label')}
        </label>
        <p className="text-xs text-ink-500">{t('settings.notifications.triggers.bigTransaction.help')}</p>
        {accounts.map((a) => (
          <AccountAmountRow
            key={a.id}
            account={a}
            value={triggers.bigTransaction.thresholds[String(a.id)]}
            onCommit={(next) => onPatch({
              triggers: {
                bigTransaction: { thresholds: withAmount(triggers.bigTransaction.thresholds, a.id, next) },
              },
            })}
          />
        ))}
      </div>

      <div className="rounded-lg border border-ink-800 p-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={triggers.accountLow.enabled}
            onChange={(e) => onPatch({ triggers: { accountLow: { enabled: e.target.checked } } })}
          />
          {t('settings.notifications.triggers.accountLow.label')}
        </label>
        <p className="text-xs text-ink-500">{t('settings.notifications.triggers.accountLow.help')}</p>
        {accounts.map((a) => (
          <AccountAmountRow
            key={a.id}
            account={a}
            value={triggers.accountLow.floors[String(a.id)]}
            onCommit={(next) => onPatch({
              triggers: {
                accountLow: { floors: withAmount(triggers.accountLow.floors, a.id, next) },
              },
            })}
          />
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={triggers.envelopeExceeded.enabled}
          onChange={(e) => onPatch({ triggers: { envelopeExceeded: { enabled: e.target.checked } } })}
        />
        {t('settings.notifications.triggers.envelopeExceeded.label')}
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={triggers.bankSyncFailed.enabled}
          onChange={(e) => onPatch({ triggers: { bankSyncFailed: { enabled: e.target.checked } } })}
        />
        {t('settings.notifications.triggers.bankSyncFailed.label')}
      </label>
    </div>
  );
}
