// Locked-boot unlock server for the Tauri desktop sidecar. When the data
// directory holds an encryption marker (see snapshotStore.ts), the real
// Fastify app cannot start yet — there's no plaintext database to serve
// from. Instead, tauri.ts binds this tiny plain node:http server first,
// prints its port as the `ATHENA_PORT` contract line so the Rust shell
// points the WebView at it, and shows a French password prompt. Once the
// right password decrypts the on-disk snapshot, the promise this module
// returns resolves with the plaintext dump and the server closes so the
// real app can bind the same port.
//
// Deliberately no Fastify here: this surface only ever serves three fixed
// routes and needs to be usable before any of the app's dynamic DB imports
// have run, so it stays dependency-free (node:http only).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readSnapshot } from '../db/snapshotStore.js';
import { decryptBuffer, EnvelopeDecryptError } from '../lib/binaryEnvelope.js';

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Athena Accounting</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; background: #111827; color: #e5e7eb; }
  form { background: #1f2937; padding: 2rem; border-radius: 0.75rem; width: 20rem; max-width: 90vw; }
  h1 { font-size: 1.1rem; margin: 0 0 1.25rem; }
  label { display: block; font-size: 0.9rem; margin-bottom: 0.4rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.6rem; border-radius: 0.4rem;
          border: 1px solid #374151; background: #111827; color: #e5e7eb; font-size: 1rem; }
  button { margin-top: 1rem; width: 100%; padding: 0.6rem; border: none; border-radius: 0.4rem;
           background: #2563eb; color: white; font-size: 1rem; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  p.error { color: #f87171; font-size: 0.9rem; margin: 0.75rem 0 0; }
  p.error.hidden { display: none; }
</style>
</head>
<body>
<form id="unlock-form">
  <h1>Athena Accounting</h1>
  <label for="password">Mot de passe</label>
  <input type="password" id="password" name="password" autofocus autocomplete="current-password" />
  <button type="submit">Déverrouiller</button>
  <p class="error hidden" id="error">Mot de passe incorrect</p>
</form>
<script>
(function () {
  var form = document.getElementById('unlock-form');
  var input = document.getElementById('password');
  var error = document.getElementById('error');
  var button = form.querySelector('button');

  function poll() {
    fetch('/health')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.locked === false) {
          location.reload();
        } else {
          setTimeout(poll, 300);
        }
      })
      .catch(function () {
        setTimeout(poll, 300);
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    error.classList.add('hidden');
    button.disabled = true;
    fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (result) {
        if (result.status === 200 && result.data && result.data.ok) {
          poll();
        } else {
          error.classList.remove('hidden');
          button.disabled = false;
        }
      })
      .catch(function () {
        error.classList.remove('hidden');
        button.disabled = false;
      });
  });
})();
</script>
</body>
</html>
`;

export interface UnlockResult {
  port: number;
  passphrase: string;
  snapshot: Buffer;
}

// Keeps a single wrong-password-guessing script (or a curious LAN neighbor —
// this only ever binds 127.0.0.1, but defense in depth) from streaming an
// unbounded body at the process before the JSON.parse ever runs.
const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      // Breaking out of the for-await loop runs its implicit iterator
      // cleanup, which destroys/unpipes the underlying request stream —
      // no need to manually drain or destroy `req` ourselves.
      throw new BodyTooLargeError();
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function runUnlockServer(opts: { dir: string; port?: number }): Promise<UnlockResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        server.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    });

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';

      if (method === 'GET' && url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }

      if (method === 'GET' && url === '/health') {
        sendJson(res, 200, { ok: false, locked: true, driver: 'pglite' });
        return;
      }

      if (method === 'POST' && url === '/api/unlock') {
        let password: string;
        try {
          const raw = await readBody(req);
          const parsed = JSON.parse(raw) as { password?: unknown };
          if (typeof parsed.password !== 'string' || parsed.password.length === 0) {
            throw new Error('missing password');
          }
          password = parsed.password;
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            sendJson(res, 413, { error: 'payload too large' });
          } else {
            sendJson(res, 400, { error: 'invalid input' });
          }
          return;
        }

        let snapshot: Buffer;
        try {
          const encrypted = await readSnapshot(opts.dir);
          snapshot = decryptBuffer(encrypted, password);
        } catch (err) {
          // Only a wrong password (a failed decrypt/auth-tag check) is a
          // 403 — readSnapshot() throwing (missing/unreadable snapshot
          // file, e.g. both `cur` and `.bak` gone) is a different failure
          // mode entirely and must not be reported as "wrong password",
          // which would send the user into an unwinnable retry loop.
          if (err instanceof EnvelopeDecryptError) {
            sendJson(res, 403, { error: 'wrong password' });
          } else {
            console.error('[unlockServer] snapshot unreadable', err);
            sendJson(res, 500, { error: 'snapshot unreadable' });
          }
          return;
        }

        // Respond and let the response flush to the socket before resolving
        // and closing the listener — server.close() only stops accepting new
        // connections, it does not tear down the in-flight response. Send
        // `Connection: close` so the client doesn't keep this socket alive
        // for reuse — the caller is about to hand this exact port to the
        // real app, and a lingering keep-alive connection to the now-closed
        // unlock server would otherwise still look "reachable".
        sendJson(res, 200, { ok: true }, { Connection: 'close' });
        const { port } = server.address() as AddressInfo;
        resolve({ port, passphrase: password, snapshot });
        server.close();
        return;
      }

      sendJson(res, 423, { error: 'locked' });
    }

    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      // A bare EventEmitter with zero 'error' listeners throws uncaught on
      // the next error — swap the bind-time `reject` for a permanent
      // no-op-but-logging listener so a late error (an aborted client
      // connection, EPIPE on the way down while closing, ...) can never
      // crash the whole sidecar process.
      server.on('error', (err) => {
        console.error('[unlockServer] error', err);
      });
    });
  });
}
