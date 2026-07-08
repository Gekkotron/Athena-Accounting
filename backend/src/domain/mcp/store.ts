import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings, users } from '../../db/schema.js';

async function upsertMcp(uid: number, patch: { mcpEnabled?: boolean; mcpKeyWrapped?: string | null }): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId: uid, ...patch })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function getMcpState(uid: number): Promise<{ enabled: boolean; hasToken: boolean }> {
  const [row] = await db
    .select({ enabled: userSettings.mcpEnabled, keyWrapped: userSettings.mcpKeyWrapped })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return { enabled: row?.enabled ?? false, hasToken: !!row?.keyWrapped };
}

export async function setMcpEnabled(uid: number, enabled: boolean): Promise<void> {
  await upsertMcp(uid, { mcpEnabled: enabled });
}

export async function setMcpWrappedKey(uid: number, wrapped: string | null): Promise<void> {
  await upsertMcp(uid, { mcpKeyWrapped: wrapped });
}

export async function getMcpByUsername(
  username: string,
): Promise<{ userId: number; enabled: boolean; keyWrapped: string | null } | null> {
  const [row] = await db
    .select({
      userId: users.id,
      enabled: userSettings.mcpEnabled,
      keyWrapped: userSettings.mcpKeyWrapped,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.username, username));
  if (!row) return null;
  return { userId: row.userId, enabled: row.enabled ?? false, keyWrapped: row.keyWrapped ?? null };
}
