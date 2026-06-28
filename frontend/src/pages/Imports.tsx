import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../api/client';
import type { Account, FileImport } from '../api/types';
import { formatDateTime } from '../lib/format';

export function Imports() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [overrideAccountId, setOverrideAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    filename: string;
    inserted: number;
    skipped: number;
    total: number;
  } | null>(null);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const importsQ = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ imports: FileImport[] }>('/api/imports'),
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      apiUpload<{
        filename: string;
        insertedCount: number;
        dedupSkipped: number;
        totalLines: number;
      }>('/api/imports', file, {
        query: overrideAccountId ? { accountId: overrideAccountId } : undefined,
      }),
    onSuccess: (data, file) => {
      setLastResult({
        filename: file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        total: data.totalLines,
      });
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: ApiError) => {
      setError(err.message);
      setLastResult(null);
    },
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    upload.mutate(file);
  };

  const accountName = (id: number) =>
    accountsQ.data?.accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
        <p className="text-sm text-slate-500">
          OFX (Latin-1/UTF-8) ou CSV (FR, séparateur « ; », décimale virgule, dates JJ/MM/AAAA).
          Le compte cible est déduit du nom du fichier — surchargez-le si nécessaire.
        </p>
      </div>

      <div className="card p-5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="label">Fichier (.ofx / .qfx / .csv)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".ofx,.qfx,.csv"
            onChange={onFile}
            disabled={upload.isPending}
            className="block text-sm text-slate-300 file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:text-emerald-950 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-emerald-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">Compte (override)</label>
          <select
            className="input w-56"
            value={overrideAccountId}
            onChange={(e) => setOverrideAccountId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Auto (via le nom du fichier)</option>
            {(accountsQ.data?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {upload.isPending && <div className="text-sm text-slate-400">Import en cours…</div>}
      </div>

      {error && (
        <div className="rounded-md border border-rose-900 bg-rose-950 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm">
          <div className="text-emerald-200">
            <strong>{lastResult.filename}</strong> · {lastResult.total} ligne(s) lue(s)
          </div>
          <div className="text-slate-300 mt-1">
            <span className="text-emerald-400">{lastResult.inserted}</span> insérée(s),{' '}
            <span className="text-slate-400">{lastResult.skipped}</span> ignorée(s) par déduplication
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-slate-200 mb-3">Historique des imports</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 font-normal">Fichier</th>
                <th className="px-4 py-3 font-normal">Compte</th>
                <th className="px-4 py-3 font-normal">Format</th>
                <th className="px-4 py-3 font-normal text-right">Lues</th>
                <th className="px-4 py-3 font-normal text-right">Insérées</th>
                <th className="px-4 py-3 font-normal text-right">Dédupliquées</th>
                <th className="px-4 py-3 font-normal">Quand</th>
              </tr>
            </thead>
            <tbody>
              {(importsQ.data?.imports ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Aucun import pour l'instant
                  </td>
                </tr>
              ) : (
                (importsQ.data?.imports ?? []).map((i) => (
                  <tr key={i.id} className="border-b border-slate-900 last:border-0">
                    <td className="px-4 py-2 text-slate-200 font-mono text-xs">{i.filename}</td>
                    <td className="px-4 py-2 text-slate-300">{accountName(i.accountId)}</td>
                    <td className="px-4 py-2">
                      <span className="badge text-[10px] py-0">{i.format}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400">{i.totalLines}</td>
                    <td className="px-4 py-2 text-right text-emerald-400">{i.insertedCount}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{i.dedupSkipped}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">{formatDateTime(i.importedAt)}</td>
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
