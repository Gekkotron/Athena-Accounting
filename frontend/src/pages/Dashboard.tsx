import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account, BalancePoint } from '../api/types';
import { formatAmount, amountSignClass } from '../lib/format';
import { BalanceChart } from '../components/BalanceChart';

export function Dashboard() {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string; account_count: number }[] }>(
      '/api/reports/balance',
    ),
  });
  const seriesQ = useQuery({
    queryKey: ['reports', 'timeseries'],
    queryFn: () => api<{ points: BalancePoint[] }>('/api/reports/timeseries', {
      query: { granularity: 'day' },
    }),
  });

  const currencies = balanceQ.data?.perCurrency ?? [];
  const accounts = accountsQ.data?.accounts ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500">Vue d'ensemble de vos comptes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {currencies.length === 0 ? (
          <div className="card p-5 col-span-3 text-sm text-slate-500">
            Aucun compte pour l'instant — créez votre premier compte dans l'onglet « Comptes ».
          </div>
        ) : (
          currencies.map((c) => (
            <div key={c.currency} className="card p-5">
              <div className="label">Solde total · {c.currency}</div>
              <div className={`mt-1 text-2xl font-semibold ${amountSignClass(c.total)}`}>
                {formatAmount(c.total, c.currency)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{c.account_count} compte(s)</div>
            </div>
          ))
        )}
      </div>

      {currencies.length > 0 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-sm font-medium text-slate-200">Évolution du solde</div>
              <div className="text-xs text-slate-500">Cumul quotidien, devise {currencies[0]?.currency}</div>
            </div>
          </div>
          {seriesQ.data && currencies[0] ? (
            <BalanceChart points={seriesQ.data.points} currency={currencies[0].currency} />
          ) : (
            <div className="h-24 animate-pulse rounded bg-slate-900" />
          )}
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-3">Soldes par compte</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 font-normal">Nom</th>
                <th className="px-4 py-3 font-normal">Type</th>
                <th className="px-4 py-3 font-normal">Devise</th>
                <th className="px-4 py-3 font-normal text-right">Solde courant</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    Aucun compte
                  </td>
                </tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-900 last:border-0">
                    <td className="px-4 py-3 text-slate-200">{a.name}</td>
                    <td className="px-4 py-3 text-slate-400">{a.type}</td>
                    <td className="px-4 py-3 text-slate-400">{a.currency}</td>
                    <td className={`px-4 py-3 text-right font-mono ${amountSignClass(a.currentBalance ?? '0')}`}>
                      {formatAmount(a.currentBalance ?? '0', a.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
