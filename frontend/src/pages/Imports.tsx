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
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Imports</h1>
          <p className="page-subtitle">
            OFX (Latin-1/UTF-8) ou CSV FR (séparateur « ; », décimale virgule, dates JJ/MM/AAAA).
          </p>
        </div>
      </div>

      <div className="surface p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="label">Fichier (.ofx · .qfx · .csv)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.qfx,.csv"
              onChange={onFile}
              disabled={upload.isPending}
              className="block text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sage-300 file:text-ink-950 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-sage-200 file:transition"
            />
          </div>
          <div className="flex flex-col gap-1.5 w-full md:w-56">
            <label className="label">Compte (override)</label>
            <select
              className="input"
              value={overrideAccountId}
              onChange={(e) => setOverrideAccountId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Auto (via nom du fichier)</option>
              {(accountsQ.data?.accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
        {upload.isPending && <div className="mt-4 text-sm text-ink-400 display-italic">Import en cours…</div>}
      </div>

      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import</div>
          <div className="font-mono text-sm text-ink-100">{lastResult.filename}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="display text-2xl text-ink-100">{lastResult.total}</span>
              <span className="text-ink-500 ml-2">lue{lastResult.total > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-sage-300">{lastResult.inserted}</span>
              <span className="text-ink-500 ml-2">insérée{lastResult.inserted > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-ink-400">{lastResult.skipped}</span>
              <span className="text-ink-500 ml-2">dédupliquée{lastResult.skipped > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="section-rule mb-4">Historique</div>
        <div className="surface overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b border-ink-800/70">
                  <th className="px-4 py-3 label font-normal">Fichier</th>
                  <th className="px-4 py-3 label font-normal">Compte</th>
                  <th className="px-4 py-3 label font-normal">Format</th>
                  <th className="px-4 py-3 label font-normal text-right">Lues</th>
                  <th className="px-4 py-3 label font-normal text-right">Insérées</th>
                  <th className="px-4 py-3 label font-normal text-right">Dédup.</th>
                  <th className="px-4 py-3 label font-normal">Quand</th>
                </tr>
              </thead>
              <tbody>
                {(importsQ.data?.imports ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-ink-500 display-italic">
                      Aucun import pour l'instant.
                    </td>
                  </tr>
                ) : (
                  (importsQ.data?.imports ?? []).map((i) => (
                    <tr key={i.id} className="border-b border-ink-800/40 last:border-0">
                      <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{i.filename}</td>
                      <td className="px-4 py-2.5 text-ink-300">{accountName(i.accountId)}</td>
                      <td className="px-4 py-2.5"><span className="badge">{i.format}</span></td>
                      <td className="px-4 py-2.5 text-right text-ink-300 font-mono">{i.totalLines}</td>
                      <td className="px-4 py-2.5 text-right text-sage-300 font-mono">{i.insertedCount}</td>
                      <td className="px-4 py-2.5 text-right text-ink-400 font-mono">{i.dedupSkipped}</td>
                      <td className="px-4 py-2.5 text-ink-400 text-xs whitespace-nowrap">{formatDateTime(i.importedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
