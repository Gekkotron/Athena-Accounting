import { createConnection, type Socket } from 'node:net';
import { isBackupFilename } from './dump.js';
import { assertPlainName, BackupProviderError, type BackupProvider } from './providers.js';

// Minimal FTP client for the FTP backup destination — the Freebox's disk
// only speaks FTP/SMB (no WebDAV), and FTP is the one of those a Node
// process can reach without a host-level mount. Plain FTP, passive mode,
// no npm dependency (same ethos as the WebDAV provider over fetch). The
// password travels cleartext on the LAN — the UI says so — but the
// payload is always a sealed enc1 envelope.
//
// Command surface: USER/PASS, TYPE I, PASV, CWD/MKD, STOR (to a temp name,
// then RNFR/RNTO so a dropped connection never leaves a truncated file
// under a trusted name), NLST, DELE, QUIT.

const FTP_TIMEOUT_MS = 15_000;

export type FtpDialConfig = {
  host: string;
  port: number;
  username: string;
  subdir: string | null;
};

type Reply = { code: number; text: string };

function dial(host: string, port: number, what: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection({ host, port });
    s.setTimeout(FTP_TIMEOUT_MS);
    s.once('connect', () => resolve(s));
    s.once('timeout', () => {
      s.destroy();
      reject(new BackupProviderError(`ftp ${what}: connection timed out`));
    });
    s.once('error', (e) => reject(new BackupProviderError(`ftp ${what}: ${e.message}`)));
  });
}

// Lockstep control-connection wrapper: one command in flight at a time,
// replies parsed per RFC 959 (multiline "NNN-…" until a final "NNN " line).
class FtpConn {
  private buf = '';
  private replyLines: string[] = [];
  private pending: Reply[] = [];
  private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private err: Error | null = null;

  constructor(private socket: Socket) {
    socket.setTimeout(FTP_TIMEOUT_MS);
    socket.on('timeout', () => this.fail(new BackupProviderError('ftp: control connection timed out')));
    socket.on('error', (e) => this.fail(new BackupProviderError(`ftp: ${e.message}`)));
    socket.on('close', () => this.fail(new BackupProviderError('ftp: connection closed unexpectedly')));
    socket.on('data', (chunk) => this.onData(chunk));
  }

  private fail(err: Error): void {
    if (this.err) return;
    this.err = err;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(err);
    }
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('latin1');
    let idx;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      this.replyLines.push(line);
      if (/^\d{3} /.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: this.replyLines.join('\n') };
        this.replyLines = [];
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = null;
          w.resolve(reply);
        } else {
          this.pending.push(reply);
        }
      }
    }
  }

  response(): Promise<Reply> {
    const queued = this.pending.shift();
    if (queued) return Promise.resolve(queued);
    if (this.err) return Promise.reject(this.err);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  cmd(command: string): Promise<Reply> {
    this.socket.write(command + '\r\n');
    return this.response();
  }

  async cmdExpect(command: string, okCodes: number[], what: string): Promise<Reply> {
    const r = await this.cmd(command);
    if (!okCodes.includes(r.code)) throw new BackupProviderError(`ftp ${what}: unexpected reply ${r.code}`);
    return r;
  }

  // Best-effort teardown — the session already succeeded or failed.
  quit(): void {
    try {
      this.socket.write('QUIT\r\n');
    } catch {
      /* already gone */
    }
    this.socket.destroy();
  }
}

// Opens the passive-mode data connection. Deliberately dials the control
// connection's host rather than the IP advertised in the 227 reply —
// NATted servers advertise addresses the client can't reach.
async function pasv(conn: FtpConn, host: string): Promise<Socket> {
  const r = await conn.cmd('PASV');
  const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(r.text);
  if (r.code !== 227 || !m) throw new BackupProviderError(`ftp pasv: unexpected reply ${r.code}`);
  const port = Number(m[5]) * 256 + Number(m[6]);
  return dial(host, port, 'data connection');
}

async function enterDir(conn: FtpConn, subdir: string | null): Promise<void> {
  const segments = (subdir ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    const r = await conn.cmd(`CWD ${seg}`);
    if (r.code === 250) continue;
    // Missing directory — create it then retry once (mirror of the WebDAV
    // provider's MKCOL-on-409).
    await conn.cmd(`MKD ${seg}`);
    await conn.cmdExpect(`CWD ${seg}`, [250], 'cwd');
  }
}

async function withFtp<T>(
  cfg: FtpDialConfig,
  password: string,
  fn: (conn: FtpConn) => Promise<T>,
): Promise<T> {
  const socket = await dial(cfg.host, cfg.port, 'connect');
  const conn = new FtpConn(socket);
  try {
    const greeting = await conn.response();
    if (greeting.code !== 220) throw new BackupProviderError(`ftp greeting: unexpected reply ${greeting.code}`);
    let r = await conn.cmd(`USER ${cfg.username}`);
    if (r.code === 331) r = await conn.cmd(`PASS ${password}`);
    if (r.code !== 230) throw new BackupProviderError(`ftp login: authentication failed (${r.code})`);
    await conn.cmdExpect('TYPE I', [200], 'binary mode');
    await enterDir(conn, cfg.subdir);
    return await fn(conn);
  } finally {
    conn.quit();
  }
}

function sendAll(data: Socket, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    data.once('error', (e) => reject(new BackupProviderError(`ftp data connection: ${e.message}`)));
    data.end(new Uint8Array(bytes), () => resolve());
  });
}

function readAll(data: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    data.on('data', (c) => chunks.push(c));
    data.once('error', (e) => reject(new BackupProviderError(`ftp data connection: ${e.message}`)));
    data.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

export function createFtpProvider(cfg: FtpDialConfig, password: string): BackupProvider {
  return {
    async upload(name, bytes) {
      assertPlainName(name);
      await withFtp(cfg, password, async (conn) => {
        const tmp = `.tmp-${name}`;
        const data = await pasv(conn, cfg.host);
        const r = await conn.cmd(`STOR ${tmp}`);
        if (r.code !== 125 && r.code !== 150) {
          data.destroy();
          throw new BackupProviderError(`ftp upload: unexpected reply ${r.code}`);
        }
        await sendAll(data, bytes);
        const done = await conn.response();
        if (done.code !== 226 && done.code !== 250) {
          throw new BackupProviderError(`ftp upload: unexpected reply ${done.code}`);
        }
        await conn.cmdExpect(`RNFR ${tmp}`, [350], 'rename');
        await conn.cmdExpect(`RNTO ${name}`, [250], 'rename');
      });
    },
    async list() {
      return withFtp(cfg, password, async (conn) => {
        const data = await pasv(conn, cfg.host);
        const r = await conn.cmd('NLST');
        // Some servers 450/550 an empty directory instead of sending an
        // empty listing.
        if (r.code === 450 || r.code === 550) {
          data.destroy();
          return [];
        }
        if (r.code !== 125 && r.code !== 150) {
          data.destroy();
          throw new BackupProviderError(`ftp list: unexpected reply ${r.code}`);
        }
        const listing = await readAll(data);
        const done = await conn.response();
        if (done.code !== 226 && done.code !== 250) {
          throw new BackupProviderError(`ftp list: unexpected reply ${done.code}`);
        }
        return listing
          .toString('latin1')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .map((l) => l.split('/').filter(Boolean).pop() ?? '')
          .filter(isBackupFilename)
          .sort();
      });
    },
    async remove(name) {
      assertPlainName(name);
      await withFtp(cfg, password, async (conn) => {
        const r = await conn.cmd(`DELE ${name}`);
        // 550 = already gone — deletion is idempotent, same as the other
        // providers.
        if (r.code !== 250 && r.code !== 550) {
          throw new BackupProviderError(`ftp delete: unexpected reply ${r.code}`);
        }
      });
    },
  };
}
