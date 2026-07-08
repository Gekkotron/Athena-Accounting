import { deriveContentKey, encryptEnvelope, decryptEnvelope } from './crypto.js';
import type { Config } from './config.js';

type FetchImpl = typeof fetch;

function mapError(status: number, body: unknown): string {
  const apiMsg = (body && typeof body === 'object' && 'error' in body)
    ? String((body as { error: unknown }).error) : '';
  if (status === 401 || status === 403) return 'MCP access is disabled or the token is invalid (check Réglages → MCP)';
  if (status === 404) return apiMsg || 'transaction not found';
  if (status === 400 || status === 409) return apiMsg || `request rejected (${status})`;
  return apiMsg || `backend error ${status}`;
}

export class RpcClient {
  private key: Buffer;
  constructor(private cfg: Config, private fetchImpl: FetchImpl = fetch) {
    this.key = deriveContentKey(Buffer.from(cfg.token, 'base64url'));
  }

  async rpc(op: string, args: Record<string, unknown>): Promise<unknown> {
    const req = encryptEnvelope(this.key, `athena-mcp-v1|${this.cfg.user}|req`, JSON.stringify({ op, args, ts: Date.now() }));
    let res: Awaited<ReturnType<FetchImpl>>;
    try {
      res = await this.fetchImpl(`${this.cfg.apiUrl}/api/mcp/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: this.cfg.user, v: 1, nonce: req.nonce, ct: req.ct }),
      });
    } catch (err) {
      throw new Error(`cannot reach Athena backend at ${this.cfg.apiUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      // Setup/auth failures are plaintext.
      let msg = `backend error ${res.status}`;
      try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
      throw new Error(mapError(res.status, { error: msg }));
    }
    const envelope = await res.json() as { nonce: string; ct: string };
    const plain = JSON.parse(decryptEnvelope(this.key, `athena-mcp-v1|${this.cfg.user}|res`, envelope.nonce, envelope.ct)) as { status: number; body: unknown };
    if (plain.status < 200 || plain.status >= 300) {
      throw new Error(mapError(plain.status, plain.body));
    }
    return plain.body;
  }
}
