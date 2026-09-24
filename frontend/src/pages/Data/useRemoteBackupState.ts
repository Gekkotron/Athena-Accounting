import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import {
  buildPutPayload,
  type FormError,
  type RemoteBackupForm,
} from './remote-backup-lib';

export interface DestinationStatus {
  configured: boolean;
  kind?: 'webdav' | 'folder' | 'ftp';
  config?: {
    url?: string;
    host?: string;
    port?: number;
    username?: string;
    subdir?: string | null;
    path?: string;
    keepLast?: number;
  };
  enabled?: boolean;
  lastRunAt?: string | null;
  lastError?: string | null;
  auto: { enabled: boolean; hour: number; nextAt: string | null };
}

export const EMPTY_REMOTE_BACKUP_FORM: RemoteBackupForm = {
  kind: 'webdav',
  url: '',
  host: '',
  port: '21',
  username: '',
  password: '',
  subdir: '',
  path: '',
  keepLast: '30',
  passphrase: '',
};

// The destination routes put the actionable part (connection refused,
// authentication failed, …) in `detail` next to the generic `error` —
// show both or the banner is useless for debugging.
function describeError(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const detail = (err.data as { detail?: string } | null | undefined)?.detail;
  return detail ? `${err.message} — ${detail}` : err.message;
}

export function useRemoteBackupState() {
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ['backup-destination'],
    queryFn: () => api<DestinationStatus>('/api/backup/destination'),
  });

  const [form, setForm] = useState<RemoteBackupForm>(EMPTY_REMOTE_BACKUP_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Pre-fill the non-secret fields once from the stored destination; later
  // refetches must not clobber in-progress edits.
  useEffect(() => {
    const d = status.data;
    if (hydrated || !d?.configured || !d.kind || !d.config) return;
    setForm((f) => ({
      ...f,
      kind: d.kind!,
      url: d.config!.url ?? '',
      host: d.config!.host ?? '',
      port: String(d.config!.port ?? 21),
      username: d.config!.username ?? '',
      subdir: d.config!.subdir ?? '',
      path: d.config!.path ?? '',
      keepLast: String(d.config!.keepLast ?? 30),
    }));
    setHydrated(true);
  }, [status.data, hydrated]);

  const set = (patch: Partial<RemoteBackupForm>) => {
    setFormError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const saveMut = useMutation({
    mutationFn: (payload: unknown) =>
      api<DestinationStatus>('/api/backup/destination', { method: 'PUT', json: payload }),
    onSuccess: () => {
      setForm((f) => ({ ...f, password: '', passphrase: '' }));
      qc.invalidateQueries({ queryKey: ['backup-destination'] });
    },
  });
  const runMut = useMutation({
    mutationFn: () =>
      api<{ filename: string }>('/api/backup/destination/run-now', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destination'] }),
  });
  const deleteMut = useMutation({
    mutationFn: () => api('/api/backup/destination', { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDelete(false);
      setHydrated(false);
      setForm(EMPTY_REMOTE_BACKUP_FORM);
      qc.invalidateQueries({ queryKey: ['backup-destination'] });
    },
  });

  const save = () => {
    // On a configured destination, blank secret fields mean "keep the
    // stored ones" — the backend fills them back in server-side.
    const built = buildPutPayload(form, { configured: status.data?.configured ?? false });
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    saveMut.mutate(built.payload);
  };

  const apiError = describeError(saveMut.error) ?? describeError(runMut.error);

  return {
    status, form, set, formError, apiError,
    confirmDelete, setConfirmDelete,
    saveMut, runMut, deleteMut, save,
  };
}
