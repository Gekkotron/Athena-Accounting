import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { bankConnections, bankConnectionAccounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { CONSENT_DAYS, clientFor, consentRedirectUrl, requestOrigin, upstream } from './helpers.js';

const ConnectBody = z.object({
  aspspName: z.string().trim().min(1).max(200),
  aspspCountry: z.string().trim().length(2).toUpperCase().default('FR'),
});

const SessionBody = z.object({
  code: z.string().trim().min(1).max(2_000),
});

export function registerConsent(app: FastifyInstance): void {
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
        redirectUrl: consentRedirectUrl(requestOrigin(req)),
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
}
