import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFtpProvider } from '../src/domain/backup/ftp.js';
import { BackupProviderError } from '../src/domain/backup/providers.js';
import { startFakeFtp, type FakeFtp } from './helpers/fake-ftp.js';

const NAME = 'athena-backup-2026-08-05-030000.enc.json';

let ftp: FakeFtp;
beforeEach(async () => {
  ftp = await startFakeFtp();
});
afterEach(async () => {
  await ftp.close();
});

const cfg = (over: Record<string, unknown> = {}) => ({
  host: '127.0.0.1',
  port: ftp.port,
  username: 'freebox',
  subdir: null as string | null,
  ...over,
});

describe('ftp provider', () => {
  it('logs in, sets binary mode, and uploads via temp name + rename', async () => {
    const p = createFtpProvider(cfg(), 'p4ss');
    await p.upload(NAME, Buffer.from('{"v":"enc1"}'));
    expect(ftp.files.get(NAME)?.toString()).toBe('{"v":"enc1"}');
    expect(ftp.files.has(`.tmp-${NAME}`)).toBe(false);
    expect(ftp.log).toContain('USER freebox');
    expect(ftp.log).toContain('TYPE I');
    expect(ftp.log).toContain(`STOR .tmp-${NAME}`);
    expect(ftp.log).toContain(`RNFR .tmp-${NAME}`);
    expect(ftp.log).toContain(`RNTO ${NAME}`);
  });

  it('creates the subdir with MKD when CWD fails, then retries', async () => {
    const p = createFtpProvider(cfg({ subdir: 'athena' }), 'p4ss');
    await p.upload(NAME, Buffer.from('x'));
    expect(ftp.dirs.has('athena')).toBe(true);
    const cwds = ftp.log.filter((l) => l.startsWith('CWD athena'));
    expect(ftp.log).toContain('MKD athena');
    expect(cwds.length).toBe(2); // failed CWD, then post-MKD CWD
    expect(ftp.files.has(NAME)).toBe(true);
  });

  it('maps a wrong password to a readable authentication error', async () => {
    const p = createFtpProvider(cfg(), 'wrong');
    await expect(p.upload(NAME, Buffer.from('x'))).rejects.toThrow(/authentication failed/i);
  });

  it('list() returns only backup-named files, sorted', async () => {
    ftp.files.set(NAME, Buffer.from('x'));
    ftp.files.set('athena-backup-2026-08-04-030000.enc.json', Buffer.from('x'));
    ftp.files.set('film-vacances.mkv', Buffer.from('not ours'));
    const p = createFtpProvider(cfg(), 'p4ss');
    expect(await p.list()).toEqual(['athena-backup-2026-08-04-030000.enc.json', NAME]);
  });

  it('remove() deletes a file and tolerates a missing one', async () => {
    ftp.files.set(NAME, Buffer.from('x'));
    const p = createFtpProvider(cfg(), 'p4ss');
    await p.remove(NAME);
    expect(ftp.files.has(NAME)).toBe(false);
    await expect(p.remove('athena-backup-2020-01-01-000000.enc.json')).resolves.toBeUndefined();
  });

  it('a connection refused surfaces as BackupProviderError', async () => {
    const closedPort = ftp.port;
    await ftp.close();
    const p = createFtpProvider(cfg({ port: closedPort }), 'p4ss');
    await expect(p.list()).rejects.toThrow(BackupProviderError);
    ftp = await startFakeFtp(); // afterEach closes it again
  });
});
