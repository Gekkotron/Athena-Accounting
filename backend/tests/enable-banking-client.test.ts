import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  buildJwt,
  createEnableBankingClient,
  EnableBankingError,
} from '../src/services/enable-banking/client.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Call = { url: string; init: RequestInit | undefined };

// Fake fetch returning queued responses and recording every call.
function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('fake fetch exhausted');
    return next;
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('buildJwt', () => {
  it('produces the Enable Banking JWT shape (kid header, iss/aud, exp = iat + 1h)', () => {
    const jwt = buildJwt(APP_ID, privateKeyPem, 1_700_000_000);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    expect(decodePart(parts[0]!)).toEqual({ typ: 'JWT', alg: 'RS256', kid: APP_ID });
    const payload = decodePart(parts[1]!);
    expect(payload.iss).toBe('enablebanking.com');
    expect(payload.aud).toBe('api.enablebanking.com');
    expect(payload.iat).toBe(1_700_000_000);
    expect(payload.exp).toBe(1_700_000_000 + 3600);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(24 * 3600);
  });

  it('signs with RS256 verifiable by the public key', () => {
    const jwt = buildJwt(APP_ID, privateKeyPem, 1_700_000_000);
    const [h, p, sig] = jwt.split('.') as [string, string, string];
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${p}`)
      .verify(publicKey, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });

  it('throws on a malformed private key', () => {
    expect(() => buildJwt(APP_ID, 'not-a-pem')).toThrow();
  });
});

describe('createEnableBankingClient', () => {
  function client(responses: Response[]) {
    const { fetch, calls } = fakeFetch(responses);
    return {
      calls,
      client: createEnableBankingClient({
        applicationId: APP_ID,
        privateKey: privateKeyPem,
        fetchImpl: fetch,
      }),
    };
  }

  it('sends a Bearer JWT on every request', async () => {
    const { client: c, calls } = client([jsonResponse({ name: 'app' })]);
    await c.getApplication();
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[0]!.url).toBe('https://api.enablebanking.com/application');
  });

  it('builds the aspsps query URL', async () => {
    const { client: c, calls } = client([jsonResponse({ aspsps: [] })]);
    await c.getAspsps('FR');
    expect(calls[0]!.url).toBe('https://api.enablebanking.com/aspsps?country=FR');
  });

  it('posts the documented /auth body shape', async () => {
    const { client: c, calls } = client([jsonResponse({ url: 'https://bank.example/consent' })]);
    const res = await c.startAuth({
      aspspName: 'CIC',
      aspspCountry: 'FR',
      redirectUrl: 'http://athena.lan/bank-sync/callback',
      state: 'nonce-1',
      validUntil: '2026-10-30T00:00:00.000Z',
    });
    expect(res.url).toBe('https://bank.example/consent');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      access: { valid_until: '2026-10-30T00:00:00.000Z' },
      aspsp: { name: 'CIC', country: 'FR' },
      state: 'nonce-1',
      redirect_url: 'http://athena.lan/bank-sync/callback',
      psu_type: 'personal',
    });
  });

  it('throws EnableBankingError with upstream status and body on non-2xx', async () => {
    const { client: c } = client([jsonResponse({ detail: 'invalid signature' }, 401)]);
    const err = await c.getApplication().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnableBankingError);
    expect((err as EnableBankingError).status).toBe(401);
    expect((err as EnableBankingError).body).toEqual({ detail: 'invalid signature' });
  });

  it('follows continuation_key across transaction pages', async () => {
    const { client: c, calls } = client([
      jsonResponse({
        transactions: [{ transaction_amount: { currency: 'EUR', amount: '1.00' } }],
        continuation_key: 'page-2',
      }),
      jsonResponse({
        transactions: [
          { transaction_amount: { currency: 'EUR', amount: '2.00' } },
          { transaction_amount: { currency: 'EUR', amount: '3.00' } },
        ],
        continuation_key: null,
      }),
    ]);
    const all = await c.getAllTransactions('acc-uid', { dateFrom: '2026-01-01' });
    expect(all).toHaveLength(3);
    expect(calls[0]!.url).toContain('/accounts/acc-uid/transactions?date_from=2026-01-01');
    expect(calls[1]!.url).toContain('continuation_key=page-2');
  });
});
