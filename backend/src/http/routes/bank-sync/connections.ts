import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { accounts, bankConnections, bankConnectionAccounts } from '../../../db/schema.js';
import { parseId } from '../../../lib/http.js';
import { userId } from '../../plugins/auth.js';
import { syncUserConnections } from '../../../domain/imports/bank-sync.js';
import { clientFor } from './helpers.js';

const SyncBody = z.object({
  connectionId: z.number().int().positive().optional(),
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

export function registerConnections(app: FastifyInstance): void {
  // Run the sync engine over all of the caller's connections (or a single
  // one). Consent problems come back as per-connection needs_reconnect
  // results, never as an error status for the whole request.
  app.post('/api/bank-sync/sync', async (req, reply) => {
    const uid = userId(req);
    const parsed = SyncBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const client = await clientFor(uid);
    const results = await syncUserConnections(uid, client, {
      ...(parsed.data.connectionId !== undefined ? { connectionId: parsed.data.connectionId } : {}),
    });
    return { results };
  });

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
