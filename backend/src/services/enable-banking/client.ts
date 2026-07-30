import { createSign } from 'node:crypto';

// Thin typed client for the Enable Banking REST API (AIS only).
// https://enablebanking.com/docs/api/reference/
//
// Auth: every request carries a short-lived JWT signed RS256 with the
// user's application private key; the application ID travels in the JWT
// `kid` header. Built on node:crypto — no JWT library dependency.
//
// The HTTP layer is injectable (`fetchImpl`) so tests never touch the
// network; `__setEbFetchForTests` overrides the default for route tests
// that build the client internally.

const BASE_URL = 'https://api.enablebanking.com';
const JWT_TTL_SECONDS = 3600;

export class EnableBankingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'EnableBankingError';
  }
}

type FetchLike = typeof fetch;

let testFetch: FetchLike | null = null;

// Default fetch used when the caller does not inject one. Tests replace it
// process-wide so routes that construct their own client stay offline.
export function ebFetch(): FetchLike {
  return testFetch ?? globalThis.fetch.bind(globalThis);
}

export function __setEbFetchForTests(f: FetchLike | null): void {
  testFetch = f;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function buildJwt(
  applicationId: string,
  privateKeyPem: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { typ: 'JWT', alg: 'RS256', kid: applicationId };
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: nowSeconds,
    exp: nowSeconds + JWT_TTL_SECONDS,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

// --- Response shapes (subset of fields Athena consumes) ---------------------

export type EbApplication = {
  name: string;
  environment: string;
  redirect_urls: string[];
  active: boolean;
  countries: string[];
  services: string[];
};

export type EbAspsp = {
  name: string;
  country: string;
  logo?: string | null;
};

export type EbSessionAccount = {
  uid: string;
  account_id?: { iban?: string | null } | null;
  name?: string | null;
  currency?: string | null;
  product?: string | null;
  cash_account_type?: string | null;
};

export type EbSession = {
  session_id: string;
  accounts: EbSessionAccount[];
  aspsp: { name: string; country: string };
  access: { valid_until: string };
};

export type EbSessionStatus = {
  session_id: string;
  status: 'AUTHORIZED' | 'CLOSED' | string;
  aspsp: { name: string; country: string };
  access: { valid_until: string };
};

export type EbBalance = {
  name?: string | null;
  balance_amount: { currency: string; amount: string };
  balance_type?: string | null;
  reference_date?: string | null;
};

export type EbTransaction = {
  entry_reference?: string | null;
  transaction_amount: { currency: string; amount: string };
  // ISO 20022 credit/debit indicator: CRDT = money in, DBIT = money out.
  credit_debit_indicator: 'CRDT' | 'DBIT' | string;
  status: 'BOOK' | 'PEND' | string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  bank_transaction_code?: { description?: string | null } | null;
};

export type EbTransactionsPage = {
  transactions: EbTransaction[];
  continuation_key?: string | null;
};

export type StartAuthInput = {
  aspspName: string;
  aspspCountry: string;
  redirectUrl: string;
  state: string;
  // ISO 8601 date-time; the bank clamps it to what PSD2 allows (90–180 days).
  validUntil: string;
};

export type EnableBankingClientOptions = {
  applicationId: string;
  privateKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  // Injectable clock (Unix seconds) so JWT tests are deterministic.
  now?: () => number;
};

// Safety cap on continuation_key paging — 200 pages of history is far beyond
// any real statement window and prevents a livelock on a misbehaving API.
const MAX_TRANSACTION_PAGES = 200;

export function createEnableBankingClient(opts: EnableBankingClientOptions) {
  const fetchImpl = opts.fetchImpl ?? ebFetch();
  const baseUrl = opts.baseUrl ?? BASE_URL;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const jwt = buildJwt(opts.applicationId, opts.privateKey, opts.now?.());
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        parsed = undefined;
      }
      throw new EnableBankingError(res.status, `enable banking request failed (${res.status})`, parsed);
    }
    return (await res.json()) as T;
  }

  return {
    getApplication: () => request<EbApplication>('GET', '/application'),

    getAspsps: (country: string) =>
      request<{ aspsps: EbAspsp[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}`),

    startAuth: (input: StartAuthInput) =>
      request<{ url: string }>('POST', '/auth', {
        access: { valid_until: input.validUntil },
        aspsp: { name: input.aspspName, country: input.aspspCountry },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: 'personal',
      }),

    createSession: (code: string) => request<EbSession>('POST', '/sessions', { code }),

    getSession: (sessionId: string) =>
      request<EbSessionStatus>('GET', `/sessions/${encodeURIComponent(sessionId)}`),

    getBalances: (accountUid: string) =>
      request<{ balances: EbBalance[] }>(
        'GET',
        `/accounts/${encodeURIComponent(accountUid)}/balances`,
      ),

    getTransactions: (
      accountUid: string,
      q?: { dateFrom?: string; dateTo?: string; continuationKey?: string },
    ) => {
      const params = new URLSearchParams();
      if (q?.dateFrom) params.set('date_from', q.dateFrom);
      if (q?.dateTo) params.set('date_to', q.dateTo);
      if (q?.continuationKey) params.set('continuation_key', q.continuationKey);
      const qs = params.size > 0 ? `?${params.toString()}` : '';
      return request<EbTransactionsPage>(
        'GET',
        `/accounts/${encodeURIComponent(accountUid)}/transactions${qs}`,
      );
    },

    // Follows continuation_key until exhausted and returns the concatenated
    // list. Page count is capped defensively (see MAX_TRANSACTION_PAGES).
    async getAllTransactions(
      accountUid: string,
      q?: { dateFrom?: string; dateTo?: string },
    ): Promise<EbTransaction[]> {
      const all: EbTransaction[] = [];
      let continuationKey: string | undefined;
      for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
        const res: EbTransactionsPage = await this.getTransactions(accountUid, {
          ...q,
          continuationKey,
        });
        all.push(...res.transactions);
        if (!res.continuation_key) return all;
        continuationKey = res.continuation_key;
      }
      throw new EnableBankingError(508, 'transaction paging exceeded the page cap');
    },
  };
}

export type EnableBankingClient = ReturnType<typeof createEnableBankingClient>;
