// Pure form → wire-payload logic for the Sauvegarde distante card.
// No React imports — unit-tested without a DOM.

export type RemoteBackupForm = {
  kind: 'webdav' | 'folder' | 'ftp';
  url: string;
  host: string;
  port: string; // raw text-input value (never <input type="number">)
  username: string;
  password: string;
  subdir: string;
  path: string;
  keepLast: string; // raw text-input value
  passphrase: string;
};

// password/passphrase are optional: on an already-configured destination,
// a blank field is omitted from the payload and the backend keeps the
// stored secret (secrets are never echoed back, so the inputs are always
// blank after a save).
export type PutPayload =
  | {
      kind: 'webdav';
      url: string;
      username: string;
      password?: string;
      subdir?: string;
      keepLast: number;
      passphrase?: string;
    }
  | { kind: 'folder'; path: string; keepLast: number; passphrase?: string }
  | {
      kind: 'ftp';
      host: string;
      port: number;
      username: string;
      password?: string;
      subdir?: string;
      keepLast: number;
      passphrase?: string;
    };

export type FormError =
  | 'url'
  | 'host'
  | 'port'
  | 'username'
  | 'password'
  | 'path'
  | 'keepLast'
  | 'passphrase';

// A plain-http WebDAV URL sends the password unencrypted on the LAN — the
// card shows a warning line (the backup payload itself is always sealed).
export function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

export function buildPutPayload(
  form: RemoteBackupForm,
  opts: { configured?: boolean } = {},
): { ok: true; payload: PutPayload } | { ok: false; error: FormError } {
  const configured = opts.configured ?? false;
  const keepRaw = form.keepLast.trim();
  if (!/^\d+$/.test(keepRaw) || Number(keepRaw) < 1) return { ok: false, error: 'keepLast' };
  const keepLast = Number(keepRaw);
  const rawPassphrase = form.passphrase.trim();
  // Blank on a configured destination = keep the stored passphrase.
  if (!(configured && rawPassphrase === '') && rawPassphrase.length < 8) {
    return { ok: false, error: 'passphrase' };
  }
  const passphraseField = rawPassphrase ? { passphrase: rawPassphrase } : {};
  const passwordOk = (pw: string) => pw !== '' || configured;
  const passwordField = (pw: string) => (pw ? { password: pw } : {});
  if (form.kind === 'folder') {
    const path = form.path.trim();
    if (!path.startsWith('/')) return { ok: false, error: 'path' };
    return { ok: true, payload: { kind: 'folder', path, keepLast, ...passphraseField } };
  }
  if (form.kind === 'ftp') {
    // Be forgiving with a pasted ftp:// URL — the backend wants a bare host.
    const host = form.host.trim().replace(/^ftp:\/\//i, '').replace(/\/+$/, '');
    if (!host || host.includes('://') || host.includes('/')) return { ok: false, error: 'host' };
    const portRaw = form.port.trim();
    if (!/^\d+$/.test(portRaw)) return { ok: false, error: 'port' };
    const port = Number(portRaw);
    if (port < 1 || port > 65535) return { ok: false, error: 'port' };
    const username = form.username.trim();
    if (!username) return { ok: false, error: 'username' };
    if (!passwordOk(form.password)) return { ok: false, error: 'password' };
    const subdir = form.subdir.trim();
    return {
      ok: true,
      payload: {
        kind: 'ftp',
        host,
        port,
        username,
        ...passwordField(form.password),
        ...(subdir ? { subdir } : {}),
        keepLast,
        ...passphraseField,
      },
    };
  }
  const url = form.url.trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'url' };
  const username = form.username.trim();
  if (!username) return { ok: false, error: 'username' };
  if (!passwordOk(form.password)) return { ok: false, error: 'password' };
  const subdir = form.subdir.trim();
  return {
    ok: true,
    payload: {
      kind: 'webdav',
      url,
      username,
      ...passwordField(form.password),
      ...(subdir ? { subdir } : {}),
      keepLast,
      ...passphraseField,
    },
  };
}
