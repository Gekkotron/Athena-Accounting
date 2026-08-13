// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let otherCookie: string;
let uid: number;
let otherUid: number;
let accountId: number;
let otherAccountId: number;

async function login(username: string, password: string): Promise<string> {
  await app.inject({
    method: 'POST', url: '/api/onboarding/create',
    payload: { username, password },
  });
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username, password },
  });
  const c = res.cookies[0]!;
  return `${c.name}=${c.value}`;
}

describe.skipIf(!RUN)('/api/goals', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await login('goals-user', 'goals-user-1234');
    otherCookie = await login('other-goals', 'other-goals-1234');

    const { db } = await import('../src/db/client.js');
    const { accounts, users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [u] = await db.select().from(users).where(eq(users.username, 'goals-user'));
    uid = u!.id;
    const [ou] = await db.select().from(users).where(eq(users.username, 'other-goals'));
    otherUid = ou!.id;

    const [a] = await db.insert(accounts).values({
      userId: uid, name: 'Livret A', type: 'savings', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
    const [oa] = await db.insert(accounts).values({
      userId: otherUid, name: 'Other Livret', type: 'savings', openingDate: '2025-01-01',
    }).returning();
    otherAccountId = oa!.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { savingsGoalEvents, savingsGoals } = await import('../src/db/schema.js');
    await db.delete(savingsGoalEvents);
    await db.delete(savingsGoals);
  });

  async function createGoal(overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST', url: '/api/goals',
      headers: { cookie },
      payload: {
        accountId,
        name: 'Vacances 2027',
        targetAmount: '2000.00',
        ...overrides,
      },
    });
    return res;
  }

  describe('CRUD', () => {
    it('creates a goal with defaults and returns computed columns', async () => {
      const res = await createGoal();
      expect(res.statusCode).toBe(201);
      const g = res.json().goal;
      expect(g).toMatchObject({
        name: 'Vacances 2027',
        accountId,
        targetAmount: '2000.00',
        savedAmount: '0',
        eventCount: 0,
        rawPct: 0,
        progressPct: 0,
        perMonthNeeded: null,
        overdueDays: null,
        closedAt: null,
        currency: 'EUR',
      });
    });

    it('rejects a non-positive target with 400', async () => {
      const res = await createGoal({ targetAmount: '0.00' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an invalid decimal target with 400', async () => {
      const res = await createGoal({ targetAmount: 'not-a-number' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects duplicate (accountId, name) with 409', async () => {
      const first = await createGoal();
      expect(first.statusCode).toBe(201);
      const dup = await createGoal();
      expect(dup.statusCode).toBe(409);
    });

    it('allows the same name on a different account', async () => {
      const { db } = await import('../src/db/client.js');
      const { accounts } = await import('../src/db/schema.js');
      const [other] = await db.insert(accounts).values({
        userId: uid, name: 'Livret B', type: 'savings', openingDate: '2025-01-01',
      }).returning();
      await createGoal();
      const second = await createGoal({ accountId: other!.id });
      expect(second.statusCode).toBe(201);
      // cleanup: cascades delete the goal on this Livret B when the account is dropped
      await db.delete(accounts).where((await import('drizzle-orm')).eq(accounts.id, other!.id));
    });

    it('returns 404 when creating a goal against another user\'s account (non-enumeration)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/goals',
        headers: { cookie },
        payload: { accountId: otherAccountId, name: 'x', targetAmount: '100.00' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET by id 404s across users', async () => {
      const created = await createGoal();
      const id = created.json().goal.id;
      const res = await app.inject({
        method: 'GET', url: `/api/goals/${id}`,
        headers: { cookie: otherCookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PUT patches partial fields and returns the fresh aggregate', async () => {
      const created = await createGoal();
      const id = created.json().goal.id;
      const res = await app.inject({
        method: 'PUT', url: `/api/goals/${id}`,
        headers: { cookie },
        payload: { targetAmount: '2500.00' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().goal.targetAmount).toBe('2500.00');
    });

    it('PUT with an empty patch returns 400', async () => {
      const created = await createGoal();
      const id = created.json().goal.id;
      const res = await app.inject({
        method: 'PUT', url: `/api/goals/${id}`,
        headers: { cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('close then reopen flips closed_at and 409s on state mismatch', async () => {
      const created = await createGoal();
      const id = created.json().goal.id;

      const close = await app.inject({ method: 'POST', url: `/api/goals/${id}/close`, headers: { cookie } });
      expect(close.statusCode).toBe(200);
      expect(close.json().goal.closedAt).not.toBeNull();

      const closeAgain = await app.inject({ method: 'POST', url: `/api/goals/${id}/close`, headers: { cookie } });
      expect(closeAgain.statusCode).toBe(409);

      const reopen = await app.inject({ method: 'POST', url: `/api/goals/${id}/reopen`, headers: { cookie } });
      expect(reopen.statusCode).toBe(200);
      expect(reopen.json().goal.closedAt).toBeNull();

      const reopenAgain = await app.inject({ method: 'POST', url: `/api/goals/${id}/reopen`, headers: { cookie } });
      expect(reopenAgain.statusCode).toBe(409);
    });

    it('DELETE removes the goal and cascades its events', async () => {
      const created = await createGoal();
      const id = created.json().goal.id;
      await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '100.00', eventDate: '2026-06-15' },
      });

      const del = await app.inject({ method: 'DELETE', url: `/api/goals/${id}`, headers: { cookie } });
      expect(del.statusCode).toBe(200);

      const { db } = await import('../src/db/client.js');
      const { savingsGoalEvents } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(savingsGoalEvents).where(eq(savingsGoalEvents.goalId, id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('list aggregate', () => {
    it('computes savedAmount, eventCount, rawPct and perAccount.savedSum', async () => {
      const g1 = await createGoal({ name: 'Vacances', targetAmount: '1000.00' });
      const id1 = g1.json().goal.id;
      await app.inject({
        method: 'POST', url: `/api/goals/${id1}/events`,
        headers: { cookie },
        payload: { amount: '400.00', eventDate: '2026-06-15' },
      });
      await app.inject({
        method: 'POST', url: `/api/goals/${id1}/events`,
        headers: { cookie },
        payload: { amount: '100.00', eventDate: '2026-06-16' },
      });
      await createGoal({ name: 'Fond', targetAmount: '5000.00' });

      const list = await app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } });
      expect(list.statusCode).toBe(200);
      const body = list.json();
      const withEvents = body.goals.find((g: { name: string }) => g.name === 'Vacances');
      expect(withEvents).toMatchObject({
        savedAmount: '500.00',
        eventCount: 2,
        rawPct: 50,
        progressPct: 50,
      });
      expect(body.perAccount[String(accountId)]).toEqual({ savedSum: '500.00' });
    });

    it('includeClosed=0 hides closed goals; =1 includes them', async () => {
      const g = await createGoal({ name: 'To close' });
      const id = g.json().goal.id;
      await app.inject({ method: 'POST', url: `/api/goals/${id}/close`, headers: { cookie } });

      const hidden = await app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } });
      expect(hidden.json().goals).toHaveLength(0);

      const shown = await app.inject({ method: 'GET', url: '/api/goals?includeClosed=1', headers: { cookie } });
      expect(shown.json().goals).toHaveLength(1);
    });

    it('excludes closed goals from perAccount.savedSum even with includeClosed=1', async () => {
      const g = await createGoal({ name: 'C', targetAmount: '500.00' });
      const id = g.json().goal.id;
      await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '200.00', eventDate: '2026-06-15' },
      });
      await app.inject({ method: 'POST', url: `/api/goals/${id}/close`, headers: { cookie } });

      const shown = await app.inject({ method: 'GET', url: '/api/goals?includeClosed=1', headers: { cookie } });
      expect(shown.json().perAccount[String(accountId)]).toBeUndefined();
    });

    it('does not leak another user\'s goals', async () => {
      const { db } = await import('../src/db/client.js');
      const { savingsGoals } = await import('../src/db/schema.js');
      await db.insert(savingsGoals).values({
        userId: otherUid, accountId: otherAccountId,
        name: 'Their goal', targetAmount: '999.00',
      });
      const list = await app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } });
      expect(list.json().goals).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('POST /events fires justReached=true on the transition crossing target', async () => {
      const g = await createGoal({ name: 'Cross', targetAmount: '100.00' });
      const id = g.json().goal.id;

      // Below target
      const below = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '60.00', eventDate: '2026-06-15' },
      });
      expect(below.statusCode).toBe(201);
      expect(below.json().justReached).toBe(false);

      // Crossing
      const cross = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '50.00', eventDate: '2026-06-16' },
      });
      expect(cross.json().justReached).toBe(true);

      // Above — no repeated transition
      const above = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '10.00', eventDate: '2026-06-17' },
      });
      expect(above.json().justReached).toBe(false);
    });

    it('rejects a zero-amount event with 400', async () => {
      const g = await createGoal();
      const id = g.json().goal.id;
      const res = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '0.00', eventDate: '2026-06-15' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a write to a closed goal with 400', async () => {
      const g = await createGoal();
      const id = g.json().goal.id;
      await app.inject({ method: 'POST', url: `/api/goals/${id}/close`, headers: { cookie } });
      const res = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '10.00', eventDate: '2026-06-15' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('GET events keyset-paginates on id DESC', async () => {
      const g = await createGoal();
      const id = g.json().goal.id;
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({
          method: 'POST', url: `/api/goals/${id}/events`,
          headers: { cookie },
          payload: { amount: `${i + 1}.00`, eventDate: '2026-06-15' },
        });
        ids.push(r.json().event.id);
      }
      const page1 = await app.inject({
        method: 'GET', url: `/api/goals/${id}/events?limit=2`,
        headers: { cookie },
      });
      const p1 = page1.json().events;
      expect(p1.map((e: { id: number }) => e.id)).toEqual([ids[4], ids[3]]);
      const page2 = await app.inject({
        method: 'GET', url: `/api/goals/${id}/events?limit=2&before=${ids[3]}`,
        headers: { cookie },
      });
      expect(page2.json().events.map((e: { id: number }) => e.id)).toEqual([ids[2], ids[1]]);
    });

    it('PUT edits an event; DELETE removes it', async () => {
      const g = await createGoal();
      const id = g.json().goal.id;
      const posted = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '50.00', eventDate: '2026-06-15' },
      });
      const eventId = posted.json().event.id;

      const put = await app.inject({
        method: 'PUT', url: `/api/goals/${id}/events/${eventId}`,
        headers: { cookie },
        payload: { amount: '75.00' },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().event.amount).toBe('75.00');

      const del = await app.inject({
        method: 'DELETE', url: `/api/goals/${id}/events/${eventId}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(200);
    });

    it('cross-user events access resolves as 404', async () => {
      const g = await createGoal();
      const id = g.json().goal.id;
      const list = await app.inject({
        method: 'GET', url: `/api/goals/${id}/events`,
        headers: { cookie: otherCookie },
      });
      expect(list.statusCode).toBe(404);
      const write = await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie: otherCookie },
        payload: { amount: '10.00', eventDate: '2026-06-15' },
      });
      expect(write.statusCode).toBe(404);
    });
  });

  describe('projection math', () => {
    it('sets overdueDays when past deadline and under target; no perMonthNeeded', async () => {
      const nowIso = new Date().toISOString().slice(0, 10);
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 10);
      const pastIso = past.toISOString().slice(0, 10);

      const g = await createGoal({ name: 'Late', targetAmount: '1000.00', targetDate: pastIso });
      const id = g.json().goal.id;
      await app.inject({
        method: 'POST', url: `/api/goals/${id}/events`,
        headers: { cookie },
        payload: { amount: '200.00', eventDate: nowIso },
      });
      const single = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: { cookie } });
      const g2 = single.json().goal;
      expect(g2.perMonthNeeded).toBeNull();
      expect(g2.overdueDays).toBe(10);
    });

    it('computes perMonthNeeded when the deadline is in the future', async () => {
      const future = new Date();
      future.setUTCMonth(future.getUTCMonth() + 12);
      const futureIso = future.toISOString().slice(0, 10);

      const g = await createGoal({ name: 'Future', targetAmount: '1200.00', targetDate: futureIso });
      const id = g.json().goal.id;
      const single = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: { cookie } });
      const g2 = single.json().goal;
      expect(g2.perMonthNeeded).not.toBeNull();
      // Roughly 100/mo for a 1200 € target over 12 months. Allow drift for
      // 30.44-day months + ceiling.
      const perMonth = Number(g2.perMonthNeeded);
      expect(perMonth).toBeGreaterThan(90);
      expect(perMonth).toBeLessThan(115);
    });

    it('hides both projection lines when targetDate is null', async () => {
      const g = await createGoal({ name: 'Openended', targetAmount: '500.00', targetDate: null });
      const id = g.json().goal.id;
      const single = await app.inject({ method: 'GET', url: `/api/goals/${id}`, headers: { cookie } });
      expect(single.json().goal.perMonthNeeded).toBeNull();
      expect(single.json().goal.overdueDays).toBeNull();
    });
  });

  describe('account merge', () => {
    it('repoints goals on source→target with a "(from X)" suffix on name collision', async () => {
      const { db } = await import('../src/db/client.js');
      const { accounts } = await import('../src/db/schema.js');
      const [src] = await db.insert(accounts).values({
        userId: uid, name: 'Source', type: 'savings',
        openingDate: '2025-01-01', currency: 'EUR', openingBalance: '0',
      }).returning();
      const [tgt] = await db.insert(accounts).values({
        userId: uid, name: 'Target', type: 'savings',
        openingDate: '2025-01-01', currency: 'EUR', openingBalance: '0',
      }).returning();

      // A goal on source with a name that clashes with one on target
      await app.inject({
        method: 'POST', url: '/api/goals', headers: { cookie },
        payload: { accountId: src!.id, name: 'Vacances', targetAmount: '1000.00' },
      });
      await app.inject({
        method: 'POST', url: '/api/goals', headers: { cookie },
        payload: { accountId: tgt!.id, name: 'Vacances', targetAmount: '2000.00' },
      });
      // A goal on source with a UNIQUE name (no clash) — should move as-is
      await app.inject({
        method: 'POST', url: '/api/goals', headers: { cookie },
        payload: { accountId: src!.id, name: 'iPhone', targetAmount: '1200.00' },
      });

      const merge = await app.inject({
        method: 'POST', url: `/api/accounts/${src!.id}/merge`,
        headers: { cookie },
        payload: { targetId: tgt!.id },
      });
      expect(merge.statusCode).toBe(200);
      expect(merge.json().merged.goalsMoved).toBe(2);

      const list = await app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } });
      const names = list.json().goals
        .filter((g: { accountId: number }) => g.accountId === tgt!.id)
        .map((g: { name: string }) => g.name)
        .sort();
      expect(names).toEqual(['Vacances', 'Vacances (from Source)', 'iPhone'].sort());
    });
  });

  describe('account deletion cascade', () => {
    it('deleting an account wipes its goals and their events', async () => {
      const { db } = await import('../src/db/client.js');
      const { accounts, savingsGoalEvents, savingsGoals } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const [acc] = await db.insert(accounts).values({
        userId: uid, name: 'Doomed', type: 'savings',
        openingDate: '2025-01-01', currency: 'EUR', openingBalance: '0',
      }).returning();

      const created = await app.inject({
        method: 'POST', url: '/api/goals',
        headers: { cookie },
        payload: { accountId: acc!.id, name: 'x', targetAmount: '100.00' },
      });
      const goalId = created.json().goal.id;
      await app.inject({
        method: 'POST', url: `/api/goals/${goalId}/events`,
        headers: { cookie },
        payload: { amount: '10.00', eventDate: '2026-06-15' },
      });

      await db.delete(accounts).where(eq(accounts.id, acc!.id));

      const goals = await db.select().from(savingsGoals).where(eq(savingsGoals.id, goalId));
      expect(goals).toHaveLength(0);
      const events = await db.select().from(savingsGoalEvents).where(eq(savingsGoalEvents.goalId, goalId));
      expect(events).toHaveLength(0);
    });
  });
});
