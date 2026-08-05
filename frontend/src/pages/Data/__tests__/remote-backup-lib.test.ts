import { describe, it, expect } from 'vitest';
import { buildPutPayload, isPlainHttp, type RemoteBackupForm } from '../remote-backup-lib';

const base: RemoteBackupForm = {
  kind: 'webdav',
  url: 'http://nas.local:5005/dav',
  username: 'julien',
  password: 'p4ss',
  subdir: ' athena ',
  path: '',
  keepLast: '30',
  passphrase: 'strong-backup-passphrase',
};

describe('buildPutPayload', () => {
  it('builds a webdav payload, trimming subdir', () => {
    const r = buildPutPayload(base);
    expect(r).toEqual({
      ok: true,
      payload: {
        kind: 'webdav',
        url: 'http://nas.local:5005/dav',
        username: 'julien',
        password: 'p4ss',
        subdir: 'athena',
        keepLast: 30,
        passphrase: 'strong-backup-passphrase',
      },
    });
  });
  it('omits a blank subdir', () => {
    const r = buildPutPayload({ ...base, subdir: '  ' });
    expect(r.ok && !('subdir' in r.payload)).toBe(true);
  });
  it('builds a folder payload', () => {
    const r = buildPutPayload({ ...base, kind: 'folder', path: '/mnt/nas/backups' });
    expect(r).toEqual({
      ok: true,
      payload: {
        kind: 'folder',
        path: '/mnt/nas/backups',
        keepLast: 30,
        passphrase: 'strong-backup-passphrase',
      },
    });
  });
  it('rejects bad keepLast values', () => {
    for (const bad of ['', '0', '-3', '3.5', 'trente']) {
      expect(buildPutPayload({ ...base, keepLast: bad })).toEqual({ ok: false, error: 'keepLast' });
    }
  });
  it('rejects a short passphrase', () => {
    expect(buildPutPayload({ ...base, passphrase: 'short' })).toEqual({ ok: false, error: 'passphrase' });
  });
  it('rejects a non-http url, a blank password, a relative path', () => {
    expect(buildPutPayload({ ...base, url: 'ftp://nas' })).toEqual({ ok: false, error: 'url' });
    expect(buildPutPayload({ ...base, password: '' })).toEqual({ ok: false, error: 'password' });
    expect(buildPutPayload({ ...base, kind: 'folder', path: 'mnt/nas' })).toEqual({ ok: false, error: 'path' });
  });
});

describe('isPlainHttp', () => {
  it('flags http but not https', () => {
    expect(isPlainHttp('http://freebox.local/dav')).toBe(true);
    expect(isPlainHttp('https://cloud.example.com')).toBe(false);
  });
});
