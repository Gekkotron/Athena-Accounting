// Pure form → wire-payload logic for the Sauvegarde distante card.
// No React imports — unit-tested without a DOM.

export type RemoteBackupForm = {
  kind: 'webdav' | 'folder';
  url: string;
  username: string;
  password: string;
  subdir: string;
  path: string;
  keepLast: string; // raw text-input value (never <input type="number">)
  passphrase: string;
};

export type PutPayload =
  | {
      kind: 'webdav';
      url: string;
      username: string;
      password: string;
      subdir?: string;
      keepLast: number;
      passphrase: string;
    }
  | { kind: 'folder'; path: string; keepLast: number; passphrase: string };

export type FormError = 'url' | 'username' | 'password' | 'path' | 'keepLast' | 'passphrase';

// A plain-http WebDAV URL sends the password unencrypted on the LAN — the
// card shows a warning line (the backup payload itself is always sealed).
export function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

export function buildPutPayload(
  form: RemoteBackupForm,
): { ok: true; payload: PutPayload } | { ok: false; error: FormError } {
  const keepRaw = form.keepLast.trim();
  if (!/^\d+$/.test(keepRaw) || Number(keepRaw) < 1) return { ok: false, error: 'keepLast' };
  const keepLast = Number(keepRaw);
  const passphrase = form.passphrase.trim();
  if (passphrase.length < 8) return { ok: false, error: 'passphrase' };
  if (form.kind === 'folder') {
    const path = form.path.trim();
    if (!path.startsWith('/')) return { ok: false, error: 'path' };
    return { ok: true, payload: { kind: 'folder', path, keepLast, passphrase } };
  }
  const url = form.url.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'url' };
  const username = form.username.trim();
  if (!username) return { ok: false, error: 'username' };
  if (!form.password) return { ok: false, error: 'password' };
  const subdir = form.subdir.trim();
  return {
    ok: true,
    payload: {
      kind: 'webdav',
      url,
      username,
      password: form.password,
      ...(subdir ? { subdir } : {}),
      keepLast,
      passphrase,
    },
  };
}
