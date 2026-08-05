import { createServer, type Server, type Socket } from 'node:net';

// Minimal in-process FTP server for provider/route tests — loopback only,
// same hermetic policy as the bank-sync fake fetch (no external network).
// Implements just the command set the client uses: USER/PASS/TYPE/PASV/
// CWD/MKD/STOR/NLST/DELE/RNFR/RNTO/QUIT. Files live in a flat Map keyed by
// name (the cwd is tracked for CWD assertions, not for storage).

export type FakeFtp = {
  port: number;
  files: Map<string, Buffer>;
  dirs: Set<string>;
  log: string[];
  close(): Promise<void>;
};

export async function startFakeFtp(opts: { password?: string; readOnly?: boolean } = {}): Promise<FakeFtp> {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const log: string[] = [];
  const dataServers: Server[] = [];
  const expectedPass = opts.password ?? 'p4ss';

  const server = createServer((socket) => {
    let pendingData: { server: Server; conn: Promise<Socket> } | null = null;
    let renameFrom: string | null = null;
    const send = (line: string) => socket.write(line + '\r\n');
    // Multiline greeting on purpose — every test exercises the client's
    // multiline reply parsing.
    send('220-fake ftp server');
    send('220 ready');

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        void handle(line);
      }
    });
    socket.on('error', () => {});

    function openPasv(): void {
      const ds = createServer();
      dataServers.push(ds);
      const conn = new Promise<Socket>((resolve) => ds.once('connection', resolve));
      ds.listen(0, '127.0.0.1', () => {
        const p = (ds.address() as { port: number }).port;
        pendingData = { server: ds, conn };
        send(`227 Entering Passive Mode (127,0,0,1,${Math.floor(p / 256)},${p % 256})`);
      });
    }

    async function handle(line: string): Promise<void> {
      log.push(line);
      const sp = line.indexOf(' ');
      const cmd = sp === -1 ? line : line.slice(0, sp);
      const arg = sp === -1 ? '' : line.slice(sp + 1);
      switch (cmd) {
        case 'USER':
          send('331 password required');
          break;
        case 'PASS':
          send(arg === expectedPass ? '230 logged in' : '530 login incorrect');
          break;
        case 'TYPE':
          send('200 type set');
          break;
        case 'PASV':
          openPasv();
          break;
        case 'CWD':
          send(arg === '/' || dirs.has(arg) ? '250 ok' : '550 no such directory');
          break;
        case 'MKD':
          dirs.add(arg);
          send('257 created');
          break;
        case 'STOR': {
          const pd = pendingData;
          pendingData = null;
          if (!pd) {
            send('425 no data connection');
            break;
          }
          // The real Freebox FTP server refuses dot-prefixed (hidden) names
          // outright — mimic it so the client can never regress into using
          // them (dev.freebox.fr FS#3196).
          if (arg.startsWith('.') || opts.readOnly) {
            pd.server.close();
            send(`550 ${arg}: access denied`);
            break;
          }
          send('150 ok to send');
          const dsock = await pd.conn;
          const chunks: Buffer[] = [];
          dsock.on('data', (c) => chunks.push(c));
          dsock.on('end', () => {
            files.set(arg, Buffer.concat(chunks));
            pd.server.close();
            send('226 transfer complete');
          });
          break;
        }
        case 'NLST': {
          const pd = pendingData;
          pendingData = null;
          if (!pd) {
            send('425 no data connection');
            break;
          }
          send('150 here comes the listing');
          const dsock = await pd.conn;
          dsock.end([...files.keys()].join('\r\n') + '\r\n');
          pd.server.close();
          send('226 done');
          break;
        }
        case 'DELE':
          send(files.delete(arg) ? '250 deleted' : '550 not found');
          break;
        case 'RNFR':
          renameFrom = arg;
          send('350 ready for RNTO');
          break;
        case 'RNTO':
          if (renameFrom !== null && files.has(renameFrom)) {
            files.set(arg, files.get(renameFrom)!);
            files.delete(renameFrom);
            send('250 renamed');
          } else {
            send('550 rename failed');
          }
          renameFrom = null;
          break;
        case 'QUIT':
          send('221 bye');
          socket.end();
          break;
        default:
          send('502 not implemented');
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    files,
    dirs,
    log,
    close: () =>
      new Promise((resolve) => {
        for (const d of dataServers) d.close();
        server.close(() => resolve());
      }),
  };
}
