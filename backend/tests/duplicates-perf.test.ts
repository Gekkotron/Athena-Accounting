// Perf-audit regression guards for the SQL-driven duplicates refactor.
// The pre-refactor endpoint selected `transactions.*` unbounded and
// then O(N²)-paired in JS; the new shape runs a bounded self-join +
// caps groups server-side. These tests pin the new knobs (?window,
// ?limit) and the pair-rule via direct DB inserts — they bypass the
// POST /api/transactions HTTP flow so a driver quirk in the pre-
// existing suite doesn't shadow the actual perf claim.
// Requires RUN_DB_TESTS=1.
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

async function seedTx(uid: number, accountId: number, date: string, amount: string, label: string, dedupKey: string) {
  const { db } = await import('../src/db/client.js');
  const { transactions } = await import('../src/db/schema.js');
  const [row] = await db.insert(transactions).values({
    userId: uid, accountId, date, amount,
    rawLabel: label, normalizedLabel: label.toLowerCase(),
    dedupKey, categorySource: 'auto',
  }).returning({ id: transactions.id });
  return row!.id;
}

d('GET /api/transactions/duplicates — perf-audit refactor', () => {
  it('?window bounds the SQL self-join to the last N months', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    // Compute a "recent" date (well inside a 12-month window) and an
    // "ancient" date (2019 — outside any reasonable window).
    const recent = new Date();
    recent.setUTCMonth(recent.getUTCMonth() - 1);
    const recentIso = recent.toISOString().slice(0, 10);
    const ancientIso = '2019-05-10';

    // One duplicate pair inside the window, one outside. Labels are
    // Jaccard-similar (share 2 of 3 tokens after tokenization) so both
    // groups clear the 0.5 threshold.
    await seedTx(uid, accountId, recentIso, '-10.00', 'RECENT MERCHANT PARIS', 'r-a');
    await seedTx(uid, accountId, recentIso, '-10.00', 'RECENT MERCHANT LYON', 'r-b');
    await seedTx(uid, accountId, ancientIso, '-25.00', 'ANCIENT MERCHANT PARIS', 'a-a');
    await seedTx(uid, accountId, ancientIso, '-25.00', 'ANCIENT MERCHANT LYON', 'a-b');

    // Default window (12 months) — only the recent pair surfaces.
    const defaultRes = await app.inject({
      method: 'GET', url: '/api/transactions/duplicates', headers: { cookie },
    });
    const defaultGroups = defaultRes.json().groups;
    expect(defaultGroups).toHaveLength(1);
    expect(defaultGroups[0].date).toBe(recentIso);

    // ?window=240 — both pairs surface (240 months = 20 years covers 2019).
    const wideRes = await app.inject({
      method: 'GET', url: '/api/transactions/duplicates?window=240', headers: { cookie },
    });
    expect(wideRes.json().groups).toHaveLength(2);

    await app.close();
  });

  it('?limit caps the number of groups returned', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    // 5 distinct-date pairs, all in the window. Different amounts so each
    // pair forms its own group. Labels share 2 of 3 tokens so the Jaccard
    // group filter clears the 0.5 threshold.
    const base = new Date();
    base.setUTCMonth(base.getUTCMonth() - 1);
    for (let i = 0; i < 5; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() - i * 7);
      const iso = d.toISOString().slice(0, 10);
      await seedTx(uid, accountId, iso, `-${10 + i}.00`, 'STORE MERCHANT PARIS', `p${i}-a`);
      await seedTx(uid, accountId, iso, `-${10 + i}.00`, 'STORE MERCHANT LYON', `p${i}-b`);
    }

    // Default: all 5 groups.
    const all = await app.inject({
      method: 'GET', url: '/api/transactions/duplicates', headers: { cookie },
    });
    expect(all.json().groups.length).toBe(5);

    // ?limit=3 — capped to 3, most-recent first.
    const capped = await app.inject({
      method: 'GET', url: '/api/transactions/duplicates?limit=3', headers: { cookie },
    });
    const cappedGroups = capped.json().groups;
    expect(cappedGroups).toHaveLength(3);
    // Recency-sorted (most recent first).
    for (let i = 1; i < cappedGroups.length; i++) {
      expect(cappedGroups[i - 1].date >= cappedGroups[i].date).toBe(true);
    }

    await app.close();
  });

  it('SQL pair rule matches ±3 days / ±0.02 amount (regression guard for the self-join)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    const base = new Date();
    base.setUTCMonth(base.getUTCMonth() - 1);
    const day = (offset: number) => {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    // In-window pair 3 days apart, ±0.01 amount → should match.
    // Labels share tokens {store, market} so Jaccard passes.
    await seedTx(uid, accountId, day(0), '-100.00', 'STORE MARKET PARIS', 'a1');
    await seedTx(uid, accountId, day(3), '-100.01', 'STORE MARKET LYON', 'a2');
    // In-window pair 4 days apart → SQL filter drops (ABS(t2.date - t1.date) > 3).
    await seedTx(uid, accountId, day(-10), '-50.00', 'CAFE MARKET PARIS', 'b1');
    await seedTx(uid, accountId, day(-14), '-50.00', 'CAFE MARKET LYON', 'b2');
    // In-window pair with 0.05 amount drift → SQL filter drops.
    await seedTx(uid, accountId, day(-20), '-70.00', 'GYM MARKET PARIS', 'c1');
    await seedTx(uid, accountId, day(-20), '-70.05', 'GYM MARKET LYON', 'c2');
    // In-window pair with opposite signs → SIGN() filter drops.
    await seedTx(uid, accountId, day(-30), '-20.00', 'REFUND MARKET PARIS', 'd1');
    await seedTx(uid, accountId, day(-30), '20.00', 'REFUND MARKET LYON', 'd2');

    const res = await app.inject({
      method: 'GET', url: '/api/transactions/duplicates', headers: { cookie },
    });
    const groups = res.json().groups;
    // Only the first pair (Δ3d, Δ0.01) should surface.
    expect(groups).toHaveLength(1);
    expect(groups[0].transactions).toHaveLength(2);
    expect(groups[0].transactions[0].raw_label).toMatch(/STORE/);

    await app.close();
  });
});
