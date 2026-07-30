import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../../lib/http.js';
import {
  createEnableBankingClient,
  EnableBankingError,
  type EnableBankingClient,
} from '../../../services/enable-banking/client.js';
import { getCredentials } from '../../../domain/bank-sync/store.js';

// Consent horizon requested from the bank. 90 days is the PSD2 baseline every
// bank accepts; the EBA's 180-day extension is bank-dependent and some
// implementations reject (rather than clamp) a longer request — don't risk
// the whole authorization for the longer horizon.
export const CONSENT_DAYS = 90;

export async function clientFor(uid: number): Promise<EnableBankingClient> {
  const creds = await getCredentials(uid);
  if (!creds) throw new HttpError(409, 'bank sync not configured');
  return createEnableBankingClient(creds);
}

// Wrap an upstream call so Enable Banking failures surface as 502 with the
// upstream status instead of a generic 500.
export async function upstream<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof EnableBankingError) {
      throw new HttpError(502, 'enable banking request failed', { upstreamStatus: err.status });
    }
    throw err;
  }
}

export function requestOrigin(req: FastifyRequest): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && /^https?:\/\//.test(origin)) return origin;
  return `${req.protocol}://${req.headers.host ?? 'localhost'}`;
}

// The redirect URL sent to Enable Banking must byte-match a whitelisted one,
// and their Control Panel refuses plain http:// except (possibly) localhost.
// So for a plain-http LAN origin the whitelist necessarily holds the https
// twin — request that twin. The redirect is browser-side only: it lands on a
// connection error and the user flips the scheme back (documented flow); the
// authorization code survives in the address bar.
export function consentRedirectUrl(origin: string): string {
  const url = new URL(origin);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const scheme = url.protocol === 'http:' && !isLocal ? 'https:' : url.protocol;
  return `${scheme}//${url.host}/bank-sync/callback`;
}
