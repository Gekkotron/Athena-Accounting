import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { envelopeCategorySettings } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { signedDecimal } from './schemas.js';
import { expenseCategoryOwned } from './helpers.js';
import { serializeSettings } from './serializers.js';

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/envelopes/categories', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(envelopeCategorySettings)
      .where(eq(envelopeCategorySettings.userId, uid))
      .orderBy(asc(envelopeCategorySettings.categoryId));
    return { settings: rows.map(serializeSettings) };
  });

  const SettingsPutBody = z.object({
    targetAmount: signedDecimal.nullable().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    targetKind: z.enum(['save_by_date', 'monthly_recurring', 'save_up_to']).nullable().optional(),
    overspendPolicy: z.enum(['rollover_negative', 'reallocate_manual']).optional(),
  }).superRefine((data, ctx) => {
    if (data.targetAmount != null && data.targetKind == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_kind_required_with_target_amount',
        path: ['targetKind'],
      });
    }
  });
  const SettingsCatIdParam = z.object({ categoryId: z.coerce.number().int().positive() });

  app.put('/api/envelopes/categories/:categoryId', async (req, reply) => {
    const uid = userId(req);
    const idP = SettingsCatIdParam.safeParse(req.params);
    if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
    const parsed = SettingsPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, idP.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    const values = {
      userId: uid,
      categoryId: idP.data.categoryId,
      targetAmount: parsed.data.targetAmount ?? null,
      targetDate: parsed.data.targetDate ?? null,
      targetKind: parsed.data.targetKind ?? null,
      overspendPolicy: parsed.data.overspendPolicy ?? 'rollover_negative',
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(envelopeCategorySettings)
      .values(values)
      .onConflictDoUpdate({
        target: [envelopeCategorySettings.userId, envelopeCategorySettings.categoryId],
        set: {
          targetAmount: values.targetAmount,
          targetDate: values.targetDate,
          targetKind: values.targetKind,
          overspendPolicy: values.overspendPolicy,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return { settings: serializeSettings(row!) };
  });

  app.delete('/api/envelopes/categories/:categoryId', async (req, reply) => {
    const uid = userId(req);
    const idP = SettingsCatIdParam.safeParse(req.params);
    if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
    const [deleted] = await db
      .delete(envelopeCategorySettings)
      .where(and(
        eq(envelopeCategorySettings.userId, uid),
        eq(envelopeCategorySettings.categoryId, idP.data.categoryId),
      ))
      .returning({ categoryId: envelopeCategorySettings.categoryId });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
