import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, userSettings } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { SettingsSchema, mergeSettings, mergeNotifications, type FullSettings } from '../../domain/settings/schema.js';

// Load the stored JSONB for `uid`, coerce to a full settings object with
// defaults filled in, and sanitise any account-id-shaped fields so a
// dangling or cross-tenant id becomes 'all'. The stored row is not
// rewritten — only the response is filtered.
async function loadSettingsFor(uid: number): Promise<FullSettings> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  const merged = mergeSettings(row?.settings ?? {}, {});
  if (typeof merged.dashboardChartScope === 'number') {
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, merged.dashboardChartScope), eq(accounts.userId, uid)));
    if (!acc) merged.dashboardChartScope = 'all';
  }
  if (typeof merged.transactionsDefaultAccount === 'number') {
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, merged.transactionsDefaultAccount), eq(accounts.userId, uid)));
    if (!acc) merged.transactionsDefaultAccount = 'all';
  }
  return merged;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/settings', async (req) => {
    const uid = userId(req);
    return { settings: await loadSettingsFor(uid) };
  });

  app.patch('/api/settings', async (req, reply) => {
    const uid = userId(req);
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patch = parsed.data;
    // JSONB `||` is a shallow merge at the top level — for the nested
    // `notifications` key that means a partial patch (e.g. one privacy
    // checkbox) would replace the whole notifications subtree in storage,
    // wiping every sibling. On the next GET, mergeSettings would refill the
    // missing fields from DEFAULTS, silently flipping any user-set field
    // back to its default. Deep-merge notifications against the stored tree
    // first so what lands in the JSONB is a complete subtree.
    let storagePatch: typeof patch = patch;
    if (patch.notifications) {
      const [row] = await db
        .select({ settings: userSettings.settings })
        .from(userSettings)
        .where(eq(userSettings.userId, uid));
      const currentNotifications = mergeSettings(row?.settings ?? {}, {}).notifications;
      storagePatch = {
        ...patch,
        notifications: mergeNotifications(currentNotifications, patch.notifications),
      };
    }
    // Upsert: create the row if missing, otherwise shallow-merge the JSONB
    // (`settings || excluded.settings` — the right-hand side wins per key).
    await db
      .insert(userSettings)
      .values({ userId: uid, settings: storagePatch })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings: sql`${userSettings.settings} || ${JSON.stringify(storagePatch)}::jsonb`,
          updatedAt: new Date(),
        },
      });
    return { settings: await loadSettingsFor(uid) };
  });
}
