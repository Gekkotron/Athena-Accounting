import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../api/client';
import type { Account, AccountFilenamePattern, FileImport } from '../api/types';
import { formatDateTime } from '../lib/format';

// Mirrors the server-side filename → account resolver. We do it client-side
// too so the UI can show the chosen account *before* the user commits.
function resolveAccountFromFilename(
  filename: string,
  patterns: AccountFilenamePattern[],
): number | null {
  if (!filename || patterns.length === 0) return null;
  const lower = filename.toLowerCase();
  const sorted = [...patterns].sort((a, b) => b.priority - a.priority);
  for (const p of sorted) {
    if (lower.includes(p.pattern.toLowerCase())) return p.accountId;
  }
  return null;
}

type AccountChoice = 'auto' | number;

export function Imports() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [accountChoice, setAccountChoice] = useState<AccountChoice>('auto');
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
  const patternsQ = useQuery({
    queryKey: ['patterns'],
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
  });
  const importsQ = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ imports: FileImport[] }>('/api/imports'),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const patterns = patternsQ.data?.patterns ?? [];

  // Client-side preview: which account would the auto-resolver pick?
  const autoResolvedAccountId = useMemo(
    () => (pickedFile ? resolveAccountFromFilename(pickedFile.name, patterns) : null),
    [pickedFile, patterns],
  );

  // The account that will actually be sent to the backend.
  const effectiveAccountId =
    accountChoice === 'auto' ? autoResolvedAccountId : accountChoice;

  const upload = useMutation({
    mutationFn: ({ file, accountId }: { file: File; accountId: number | null }) =>
      apiUpload<{
        filename: string;
        insertedCount: number;
        dedupSkipped: number;
        totalLines: number;
      }>('/api/imports', file, {
        query: accountId ? { accountId } : undefined,
      }),
    onSuccess: (data, vars) => {
      setLastResult({
        filename: vars.file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        total: data.totalLines,
      });
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setPickedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: ApiError) => {
      setError(err.message);
      setLastResult(null);
    },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    setLastResult(null);
    setPickedFile(file);
    // Reset choice on every new file — auto might match this one when the
    // previous one didn't, and vice versa.
    setAccountChoice('auto');
  };

  const reset = () => {
    setPickedFile(null);
    setError(null);
    setAccountChoice('auto');
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = () => {
    if (!pickedFile) return;
    if (!effectiveAccountId) return;
    setError(null);
    upload.mutate({ file: pickedFile, accountId: effectiveAccountId });
  };

  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;
  const detectedAccount =
    autoResolvedAccountId !== null ? accounts.find((a) => a.id === autoResolvedAccountId) : null;
  const matchedPattern =
    detectedAccount && pickedFile
      ? [...patterns]
          .sort((a, b) => b.priority - a.priority)
          .find(
            (p) =>
              pickedFile.name.toLowerCase().includes(p.pattern.toLowerCase()) &&
              p.accountId === detectedAccount.id,
          )
      : null;

  const canImport = !!pickedFile && !!effectiveAccountId && !upload.isPending;

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

      {/* Step 1 — pick the file */}
      <div className="surface p-5 md:p-6">
        <div className="label mb-2">1. Choisir un fichier</div>
        <input
          ref={fileRef}
          type="file"
          accept=".ofx,.qfx,.csv"
          onChange={onPick}
          disabled={upload.isPending}
          className="block text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sage-300 file:text-ink-950 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-sage-200 file:transition file:cursor-pointer"
        />
      </div>

      {/* Step 2 — confirm target account */}
      {pickedFile && (
        <div className="surface p-5 md:p-6 flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="label">2. Compte cible</div>
            <button className="text-[11px] text-ink-500 hover:text-ink-200 transition" onClick={reset}>
              annuler
            </button>
          </div>
          <div className="text-sm text-ink-400">
            <span className="font-mono text-ink-200">{pickedFile.name}</span>{' '}
            <span className="text-ink-500">· {formatBytes(pickedFile.size)}</span>
          </div>

          {/* Auto-detection result */}
          {detectedAccount ? (
            <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-4 py-3 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="badge-sage">détecté</span>
                <span className="text-ink-100">
                  → <span className="font-medium">{detectedAccount.name}</span>
                </span>
              </div>
              {matchedPattern && (
                <div className="text-[11px] text-ink-500 mt-1.5 font-mono">
                  via motif « {matchedPattern.pattern} »
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-clay-800/50 bg-clay-900/15 px-4 py-3 text-sm text-clay-200">
              <div className="font-medium text-ink-100 mb-1">Aucun motif ne correspond à ce nom de fichier.</div>
              <div className="text-ink-400 text-[13px]">
                Sélectionnez un compte ci-dessous, ou{' '}
                <Link to="/accounts" className="underline text-sage-300 hover:text-sage-200">
                  configurez un motif dans Comptes
                </Link>{' '}
                pour que les imports futurs se résolvent tout seuls.
              </div>
            </div>
          )}

          {/* Manual override */}
          <div className="flex flex-col gap-1.5">
            <label className="label">Compte (override manuel)</label>
            <select
              className="input"
              value={accountChoice === 'auto' ? '' : accountChoice}
              onChange={(e) =>
                setAccountChoice(e.target.value ? Number(e.target.value) : 'auto')
              }
            >
              <option value="">
                {detectedAccount
                  ? `Auto — ${detectedAccount.name}`
                  : 'Auto — aucun (impossible)'}
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button className="btn-primary" disabled={!canImport} onClick={submit}>
              {upload.isPending
                ? 'Import en cours…'
                : effectiveAccountId
                  ? `Importer dans ${accountName(effectiveAccountId)}`
                  : 'Choisissez un compte'}
            </button>
            {effectiveAccountId === null && (
              <div className="text-xs text-ink-500">
                Aucun compte sélectionné — le bouton se débloque dès que vous en choisissez un.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {error}
        </div>
      )}

      {/* Last result */}
      {lastResult && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import</div>
          <div className="font-mono text-sm text-ink-100 truncate">{lastResult.filename}</div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mio`;
}
