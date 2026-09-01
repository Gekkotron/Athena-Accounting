import { db } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';

// Inserts a minimal `users` row for DB-integration tests and returns its
// numeric id. Username is randomized per call so repeated invocations
// (e.g. one per `beforeEach` in a single test file) never collide on the
// unique index.
export async function seedUser(): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({
      username: `test-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      passwordHash: 'x',
    })
    .returning();
  return row!.id;
}
