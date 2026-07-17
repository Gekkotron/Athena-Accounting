// The single hard-coded user used by AUTH_MODE=none (Tauri desktop).
//
// Row is upserted on first boot with a fixed id so the "no login" request
// pipeline always resolves to a real, migratable row — the app is single-user
// on the desktop path, but the users table still exists (schema is shared
// with the LAN/Docker path) and every foreign key that hangs off userId
// needs a row to point at.
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories, users } from '../../db/schema.js';

export const LOCAL_USER_ID = 1;
export const LOCAL_USERNAME = 'local';

// argon2id placeholder. Never used to authenticate — there is no login flow
// in `none` mode — but the column is NOT NULL. A dummy string keeps schema
// invariants intact without importing @node-rs/argon2 for something no code
// will ever verify.
const LOCAL_PLACEHOLDER_HASH = '$argon2id$local-user-no-login';

export async function ensureLocalUser(): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, LOCAL_USER_ID))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(users).values({
    id: LOCAL_USER_ID,
    username: LOCAL_USERNAME,
    passwordHash: LOCAL_PLACEHOLDER_HASH,
  }).onConflictDoNothing();

  // Same "Divers" seed the onboarding route gives to fresh registrants — the
  // rule engine falls back to this category when no other match wins.
  await db.insert(categories).values({
    userId: LOCAL_USER_ID,
    name: 'Divers',
    kind: 'expense',
    isDefault: true,
  }).onConflictDoNothing();
}
