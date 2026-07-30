import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createPrivateKey, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { accounts, bankConnections, bankConnectionAccounts } from '../../db/schema.js';
import { HttpError, parseId } from '../../lib/http.js';
import { userId } from '../plugins/auth.js';
import {
  createEnableBankingClient,
  EnableBankingError,
  type EnableBankingClient,
} from '../../services/enable-banking/client.js';
import {
  getCredentials,
  setCredentials,
  deleteCredentials,
  getStatus,
} from '../../domain/bank-sync/store.js';

const CredentialsBody = z.object({
  applicationId: z.string().trim().min(1).max(200),
  privateKey: z.string().trim().min(1).max(20_000),
});

const ConnectBody = z.object({
  aspspName: z.string().trim().min(1).max(200),
  aspspCountry: z.string().trim().length(2).toUpperCase().default('FR'),
});

const SessionBody = z.object({
  code: z.string().trim().min(1).max(2_000),
});

const MappingsBody = z.object({
  mappings: z
    .array(
      z.object({
        bankAccountUid: z.string().trim().min(1).max(200),
        accountId: z.number().int().positive().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

// Consent horizon requested from the bank. PSD2 caps this at 90 or 180 days
// depending on the bank's implementation — banks clamp, they don't reject.
const CONSENT_DAYS = 180;

async function clientFor(uid: number): Promise<EnableBankingClient> {
  const creds = await getCredentials(uid);
  if (!creds) throw new HttpError(409, 'bank sync not configured');
  return createEnableBankingClient(creds);
}

// Wrap an upstream call so Enable Banking failures surface as 502 with the
// upstream status instead of a generic 500.
async function upstream<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof EnableBankingError) {
      throw new HttpError(502, 'enable banking request failed', { upstreamStatus: err.status });
    }
    throw err;
  }
}

function requestOrigin(req: FastifyRequest): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && /^https?:\/\//.test(origin)) return origin;
  return `${req.protocol}://${req.headers.host ?? 'localhost'}`;
}

type ConnectionAccountRow = {
  bankAccountUid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
  accountId: number | null;
  lastSyncedAt: Date | null;
};

async function listConnections(uid: number) {
  const conns = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.userId, uid))
    .orderBy(bankConnections.id);
  if (conns.length === 0) return [];
  const accountRows = await db
    .select({
      connectionId: bankConnectionAccounts.connectionId,
      bankAccountUid: bankConnectionAccounts.bankAccountUid,
      iban: bankConnectionAccounts.iban,
      name: bankConnectionAccounts.name,
      currency: bankConnectionAccounts.currency,
      accountId: bankConnectionAccounts.accountId,
      lastSyncedAt: bankConnectionAccounts.lastSyncedAt,
    })
    .from(bankConnectionAccounts)
    .where(
      inArray(
        bankConnectionAccounts.connectionId,
        conns.map((c) => c.id),
      ),
    )
    .orderBy(bankConnectionAccounts.id);
  const byConnection = new Map<number, ConnectionAccountRow[]>();
  for (const row of accountRows) {
    const list = byConnection.get(row.connectionId) ?? [];
    const { connectionId: _omit, ...rest } = row;
    list.push(rest);
    byConnection.set(row.connectionId, list);
  }
  return conns.map((c) => ({
    id: c.id,
    aspspName: c.aspspName,
    aspspCountry: c.aspspCountry,
    validUntil: c.validUntil,
    status: c.status,
    createdAt: c.createdAt,
    accounts: byConnection.get(c.id) ?? [],
  }));
}

export async function bankSyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // --- Credentials -----------------------------------------------------------

  // Store (or replace) the user's Enable Banking application credentials.
  // The pair is validated live against GET /application before persisting so
  // a typo'd key or a deactivated application is rejected up front.
  app.put('/api/bank-sync/credentials', async (req, reply) => {
    const uid = userId(req);
    const parsed = CredentialsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { applicationId, privateKey } = parsed.data;

    try {
      createPrivateKey(privateKey);
    } catch {
      return reply.code(400).send({ error: 'invalid private key' });
    }

    const client = createEnableBankingClient({ applicationId, privateKey });
    try {
      await client.getApplication();
    } catch (err) {
      if (err instanceof EnableBankingError) {
        return reply
          .code(502)
          .send({ error: 'enable banking rejected credentials', upstreamStatus: err.status });
      }
      throw err;
    }

    await setCredentials(uid, applicationId, privateKey);
    return { configured: true, applicationId };
  });

  app.get('/api/bank-sync/status', async (req) => {
    return await getStatus(userId(req));
  });

  app.delete('/api/bank-sync/credentials', async (req) => {
    await deleteCredentials(userId(req));
    return { ok: true };
  });

  // --- Consent flow ----------------------------------------------------------

  app.get('/api/bank-sync/aspsps', async (req) => {
    const client = await clientFor(userId(req));
    const country =
      typeof (req.query as Record<string, unknown>).country === 'string'
        ? String((req.query as Record<string, unknown>).country).toUpperCase().slice(0, 2)
        : 'FR';
    const res = await upstream(client.getAspsps(country));
    return { aspsps: res.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo ?? null })) };
  });

  // Start a bank authorization: returns the bank's consent URL to navigate
  // to. The `state` nonce is required by the Enable Banking API; the
  // authorization code it redirects back with is single-use and bound to our
  // application, so the server keeps no state table for it.
  app.post('/api/bank-sync/connect', async (req, reply) => {
    const uid = userId(req);
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const client = await clientFor(uid);
    const validUntil = new Date(Date.now() + CONSENT_DAYS * 86_400_000).toISOString();
    const res = await upstream(
      client.startAuth({
        aspspName: parsed.data.aspspName,
        aspspCountry: parsed.data.aspspCountry,
        redirectUrl: `${requestOrigin(req)}/bank-sync/callback`,
        state: randomBytes(16).toString('hex'),
        validUntil,
      }),
    );
    return { url: res.url };
  });

  // Exchange the authorization code for a session and persist the connection
  // with one (unmapped) row per bank account. The client then maps accounts
  // via PUT /connections/:id/mappings.
  app.post('/api/bank-sync/sessions', async (req, reply) => {
    const uid = userId(req);
    const parsed = SessionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const client = await clientFor(uid);
    const session = await upstream(client.createSession(parsed.data.code));

    const connection = await db.transaction(async (tx) => {
      const [conn] = await tx
        .insert(bankConnections)
        .values({
          userId: uid,
          sessionId: session.session_id,
          aspspName: session.aspsp.name,
          aspspCountry: session.aspsp.country,
          validUntil: session.access.valid_until.slice(0, 10),
        })
        .returning();
      if (session.accounts.length > 0) {
        await tx.insert(bankConnectionAccounts).values(
          session.accounts.map((a) => ({
            connectionId: conn!.id,
            bankAccountUid: a.uid,
            iban: a.account_id?.iban ?? null,
            name: a.name ?? a.product ?? null,
            currency: a.currency ?? null,
          })),
        );
      }
      return conn!;
    });

    return reply.code(201).send({
      connection: {
        id: connection.id,
        aspspName: connection.aspspName,
        aspspCountry: connection.aspspCountry,
        validUntil: connection.validUntil,
        status: connection.status,
      },
      accounts: session.accounts.map((a) => ({
        uid: a.uid,
        iban: a.account_id?.iban ?? null,
        name: a.name ?? a.product ?? null,
        currency: a.currency ?? null,
      })),
    });
  });

  // --- Connections -----------------------------------------------------------

  app.get('/api/bank-sync/connections', async (req) => {
    return { connections: await listConnections(userId(req)) };
  });

  app.put('/api/bank-sync/connections/:id/mappings', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = MappingsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }

    const [conn] = await db
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, uid)));
    if (!conn) return reply.code(404).send({ error: 'not found' });

    // Every non-null accountId must belong to the caller.
    const wantedIds = [
      ...new Set(
        parsed.data.mappings.map((m) => m.accountId).filter((v): v is number => v !== null),
      ),
    ];
    if (wantedIds.length > 0) {
      const owned = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(inArray(accounts.id, wantedIds), eq(accounts.userId, uid)));
      if (owned.length !== wantedIds.length) {
        return reply.code(400).send({ error: 'unknown account' });
      }
    }

    await db.transaction(async (tx) => {
      for (const m of parsed.data.mappings) {
        await tx
          .update(bankConnectionAccounts)
          .set({ accountId: m.accountId })
          .where(
            and(
              eq(bankConnectionAccounts.connectionId, id),
              eq(bankConnectionAccounts.bankAccountUid, m.bankAccountUid),
            ),
          );
      }
    });

    const connections = await listConnections(uid);
    return { connection: connections.find((c) => c.id === id) };
  });

  app.delete('/api/bank-sync/connections/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const deleted = await db
      .delete(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, uid)))
      .returning({ id: bankConnections.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
