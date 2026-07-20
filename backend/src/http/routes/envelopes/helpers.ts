import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { categories } from '../../../db/schema.js';

export async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}
