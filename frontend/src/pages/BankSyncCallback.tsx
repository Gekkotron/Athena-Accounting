import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { LoadingBlock } from '../components/StateBlocks';
import { bankAccountLabel } from './SettingsBankSync-lib';

interface SessionResponse {
  connection: { id: number; aspspName: string; validUntil: string };
  accounts: Array<{ uid: string; iban: string | null; name: string | null; currency: string | null }>;
}

// Landing page for the bank's consent redirect (?code=...). Exchanges the
// code for a session, then lets the user map each returned bank account to
// an Athena account before heading back to Réglages.
export function BankSyncCallback(): JSX.Element {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const code = params.get('code');

  // The code is single-use: guard against StrictMode's double effect run so
  // the exchange happens exactly once.
  const started = useRef(false);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!code) {
      setError(t('settings.bankSync.callback.noCode'));
      return;
    }
    api<SessionResponse>('/api/bank-sync/sessions', { method: 'POST', json: { code } })
      .then((res) => {
        setSession(res);
        setMappings(Object.fromEntries(res.accounts.map((a) => [a.uid, null])));
        qc.invalidateQueries({ queryKey: ['bank-sync-connections'] });
      })
      .catch(() => setError(t('settings.bankSync.callback.error')));
  }, [code, qc, t]);

  async function saveMappings(): Promise<void> {
    if (!session || saving) return;
    setSaving(true);
    try {
      await api(`/api/bank-sync/connections/${session.connection.id}/mappings`, {
        method: 'PUT',
        json: {
          mappings: Object.entries(mappings).map(([bankAccountUid, accountId]) => ({
            bankAccountUid,
            accountId,
          })),
        },
      });
      qc.invalidateQueries({ queryKey: ['bank-sync-connections'] });
      navigate('/data/bank-sync', { replace: true });
    } catch {
      setError(t('settings.bankSync.errors.generic'));
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="display text-2xl text-ink-50">{t('settings.bankSync.callback.title')}</h1>
      </div>

      {error && (
        <div className="surface p-6 flex flex-col gap-4">
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
            {error}
          </div>
          <Link to="/data/bank-sync" className="btn-ghost self-start">
            {t('settings.bankSync.callback.backToSettings')}
          </Link>
        </div>
      )}

      {!error && !session && (
        <div className="surface p-6">
          <p className="text-sm text-ink-400 mb-4">{t('settings.bankSync.callback.exchanging')}</p>
          <LoadingBlock height="min-h-24" />
        </div>
      )}

      {!error && session && (
        <div className="surface p-6 flex flex-col gap-4">
          <div>
            <div className="label">
              {t('settings.bankSync.callback.mappingTitle', { name: session.connection.aspspName })}
            </div>
            <p className="text-sm text-ink-400 mt-1">{t('settings.bankSync.callback.mappingHelp')}</p>
          </div>
          <div className="flex flex-col gap-2">
            {session.accounts.map((a) => (
              <div key={a.uid} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink-200 flex-1 min-w-40">
                  {bankAccountLabel({ ...a, bankAccountUid: a.uid, accountId: null, lastSyncedAt: null })}
                </span>
                <select
                  className="input max-w-64"
                  aria-label={`${t('settings.bankSync.connections.mappingLabel')} ${a.name ?? a.uid}`}
                  value={mappings[a.uid] === null || mappings[a.uid] === undefined ? '' : String(mappings[a.uid])}
                  onChange={(e) =>
                    setMappings((prev) => ({
                      ...prev,
                      [a.uid]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">{t('settings.bankSync.connections.unmapped')}</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveMappings()}>
              {t('settings.bankSync.callback.save')}
            </button>
            <Link to="/data/bank-sync" className="btn-ghost">
              {t('settings.bankSync.callback.skip')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
