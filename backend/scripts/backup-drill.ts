// Scripted backup/restore round-trip drill.
//
// Boots Fastify against a fresh PGlite file, seeds a known dataset, exports
// via GET /api/backup/export, hashes the resulting state, then POSTs the
// same envelope through /api/backup/import and re-hashes. The two hashes
// must match — otherwise the backup path is lossy.
//
// Run: tsx backend/scripts/backup-drill.ts
//
// Environment is pinned to the Tauri profile (PGlite + AUTH_MODE=none) so
// the drill exercises the same driver end-users hit on the desktop path.
// The script picks its own temp DATA_DIR under os.tmpdir() and removes it
// at the end regardless of success/failure.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const dir = await mkdtemp(path.join(tmpdir(), 'athena-drill-'));

process.env.DATA_DIR = dir;
process.env.DB_DRIVER = 'pglite';
process.env.PGLITE_PATH = path.join(dir, 'athena.db');
process.env.AUTH_MODE = 'none';
process.env.SERVE_STATIC = 'false';
process.env.SESSION_SECRET = 'athena-drill-session-secret-not-remote-32ch';
process.env.LOG_LEVEL = 'error';

// Dynamic imports so env writes above land before env.ts is evaluated.
const { build } = await import('../src/buildServer.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { pool, db } = await import('../src/db/client.js');
const { ensureLocalUser, LOCAL_USER_ID } = await import('../src/domain/auth/localUser.js');
const schema = await import('../src/db/schema.js');
const { eq } = await import('drizzle-orm');

async function seedTransactions(app: import('fastify').FastifyInstance): Promise<void> {
  // Accounts (2)
  for (const acc of [
    { name: 'Compte courant', type: 'checking', currency: 'EUR', openingBalance: '2500', openingDate: '2026-01-15' },
    { name: 'Livret A',       type: 'savings',  currency: 'EUR', openingBalance: '8000', openingDate: '2026-01-15' },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/accounts', payload: acc });
    if (res.statusCode >= 300) throw new Error(`seed accounts: ${res.statusCode} ${res.body}`);
  }
  // Categories (8)
  for (const cat of [
    { name: 'Courses',    kind: 'expense' },
    { name: 'Restaurant', kind: 'expense' },
    { name: 'Transport',  kind: 'expense' },
    { name: 'Logement',   kind: 'expense' },
    { name: 'Énergie',    kind: 'expense' },
    { name: 'Loisirs',    kind: 'expense' },
    { name: 'Santé',      kind: 'expense' },
    { name: 'Salaire',    kind: 'income'  },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/categories', payload: cat });
    if (res.statusCode >= 300) throw new Error(`seed categories: ${res.statusCode} ${res.body}`);
  }

  // Rules (5): each ties an existing category by id — refetch to know the ids.
  const catRes = await app.inject({ method: 'GET', url: '/api/categories' });
  const cats = (JSON.parse(catRes.body) as { categories: Array<{ id: number; name: string }> }).categories;
  const catId = (name: string) => cats.find((c) => c.name === name)!.id;
  for (const rule of [
    { categoryId: catId('Transport'),  keyword: 'sncf',       signConstraint: 'negative', matchMode: 'substring', priority: 100 },
    { categoryId: catId('Courses'),    keyword: 'carrefour',  signConstraint: 'negative', matchMode: 'substring', priority: 100 },
    { categoryId: catId('Énergie'),    keyword: 'edf',        signConstraint: 'negative', matchMode: 'substring', priority: 100 },
    { categoryId: catId('Courses'),    keyword: 'monoprix',   signConstraint: 'negative', matchMode: 'substring', priority: 100 },
    { categoryId: catId('Logement'),   keyword: 'loyer',      signConstraint: 'negative', matchMode: 'substring', priority: 100 },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/rules', payload: rule });
    if (res.statusCode >= 300) throw new Error(`seed rules: ${res.statusCode} ${res.body}`);
  }

  // Budgets (3)
  for (const b of [
    { categoryId: catId('Courses'),    monthlyLimit: '400', currency: 'EUR', period: 'monthly' },
    { categoryId: catId('Restaurant'), monthlyLimit: '150', currency: 'EUR', period: 'monthly' },
    { categoryId: catId('Loisirs'),    monthlyLimit: '100', currency: 'EUR', period: 'monthly' },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/budgets', payload: b });
    if (res.statusCode >= 300) throw new Error(`seed budgets: ${res.statusCode} ${res.body}`);
  }

  // Balance checkpoint (1) — on Compte courant
  const accRes = await app.inject({ method: 'GET', url: '/api/accounts' });
  const accs = (JSON.parse(accRes.body) as { accounts: Array<{ id: number; name: string }> }).accounts;
  const courantId = accs.find((a) => a.name === 'Compte courant')!.id;
  const cpRes = await app.inject({
    method: 'POST',
    url: `/api/accounts/${courantId}/balance-checkpoints`,
    payload: { checkpointDate: '2026-04-18', expectedAmount: '2500', note: 'Vérifié' },
  });
  if (cpRes.statusCode >= 300) throw new Error(`seed checkpoint: ${cpRes.statusCode} ${cpRes.body}`);

  // Transactions (>= 200) — split across the two accounts, 6 months.
  // Direct db insert is much faster than 200 HTTP round-trips and yields
  // deterministic dedup_keys we can hash later.
  const rows: (typeof schema.transactions.$inferInsert)[] = [];
  const start = new Date('2026-02-01T00:00:00Z');
  for (let i = 0; i < 210; i++) {
    const day = new Date(start.getTime() + i * 24 * 3600 * 1000);
    const iso = day.toISOString().slice(0, 10);
    const accountId = i % 5 === 0 ? accs[1].id : accs[0].id;
    const amount = i % 6 === 0 ? '2500.00' : `-${(10 + (i * 3.7) % 90).toFixed(2)}`;
    const rawLabel = i % 6 === 0 ? 'Virement Salaire' : `Carrefour ${i.toString().padStart(3, '0')}`;
    rows.push({
      userId: LOCAL_USER_ID,
      accountId,
      date: iso,
      amount,
      rawLabel,
      normalizedLabel: rawLabel.toLowerCase(),
      dedupKey: `drill_${i}`,
      importedAt: new Date(day.getTime() + 3600 * 1000),
      categorySource: 'default',
    });
  }
  await db.insert(schema.transactions).values(rows);
}

interface StateHash {
  counts: Record<string, number>;
  lastTenSha256: string;
  combinedSha256: string;
}

async function hashState(): Promise<StateHash> {
  const uid = LOCAL_USER_ID;
  const [accs, cats, rls, txs, cps, budgets, patterns, fimps, splits] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, uid)),
    db.select().from(schema.categories).where(eq(schema.categories.userId, uid)),
    db.select().from(schema.rules).where(eq(schema.rules.userId, uid)),
    db.select().from(schema.transactions).where(eq(schema.transactions.userId, uid)),
    db.select().from(schema.balanceCheckpoints).where(eq(schema.balanceCheckpoints.userId, uid)),
    db.select().from(schema.categoryBudgets).where(eq(schema.categoryBudgets.userId, uid)),
    db.select().from(schema.accountFilenamePatterns).where(eq(schema.accountFilenamePatterns.userId, uid)),
    db.select().from(schema.fileImports).where(eq(schema.fileImports.userId, uid)),
    db.select().from(schema.transactionSplits),
  ]);
  const counts = {
    accounts: accs.length,
    categories: cats.length,
    rules: rls.length,
    transactions: txs.length,
    balanceCheckpoints: cps.length,
    budgets: budgets.length,
    accountFilenamePatterns: patterns.length,
    fileImports: fimps.length,
    transactionSplits: splits.length,
  };
  const lastTen = [...txs]
    .sort((a, b) => a.dedupKey.localeCompare(b.dedupKey))
    .slice(-10)
    .map((t) => ({
      accountName: accs.find((a) => a.id === t.accountId)?.name ?? null,
      date: t.date,
      amount: t.amount,
      rawLabel: t.rawLabel,
      normalizedLabel: t.normalizedLabel,
      categoryName: t.categoryId ? cats.find((c) => c.id === t.categoryId)?.name ?? null : null,
      dedupKey: t.dedupKey,
    }));
  const lastTenSha256 = crypto.createHash('sha256').update(JSON.stringify(lastTen)).digest('hex');
  const combinedSha256 = crypto.createHash('sha256')
    .update(JSON.stringify({ counts, lastTenSha256 }))
    .digest('hex');
  return { counts, lastTenSha256, combinedSha256 };
}

function fmt(hash: StateHash): string {
  const counts = Object.entries(hash.counts)
    .map(([k, v]) => `  ${k.padEnd(24)} ${v}`)
    .join('\n');
  return `${counts}\n  lastTenSha256            ${hash.lastTenSha256}\n  combinedSha256           ${hash.combinedSha256}`;
}

const timings: Record<string, number> = {};
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  timings[label] = performance.now() - t0;
  return r;
}

console.log(`Drill running in ${dir}`);

try {
  await step('migrate', () => runMigrations());
  await step('ensureLocalUser', () => ensureLocalUser());
  const app = await build();

  await step('seed', () => seedTransactions(app));
  const hashPre = await step('hashPre', () => hashState());
  console.log('\n[pre-export]');
  console.log(fmt(hashPre));

  const exp = await step('export', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backup/export' });
    if (res.statusCode >= 300) throw new Error(`export: ${res.statusCode} ${res.body}`);
    return res.body;
  });
  const expSha = crypto.createHash('sha256').update(exp).digest('hex');
  const expPath = path.join(dir, 'export.json');
  await writeFile(expPath, exp);
  console.log(`\n[export] file ${expPath}`);
  console.log(`  size                     ${exp.length} bytes`);
  console.log(`  sha256                   ${expSha}`);

  await step('restore', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/backup/import',
      headers: { 'content-type': 'application/json' },
      payload: exp,
    });
    if (res.statusCode >= 300) throw new Error(`restore: ${res.statusCode} ${res.body}`);
  });
  const hashPost = await step('hashPost', () => hashState());
  console.log('\n[post-restore]');
  console.log(fmt(hashPost));

  const ok = hashPre.combinedSha256 === hashPost.combinedSha256;
  console.log(`\n[result] round-trip ${ok ? 'MATCH ✓' : 'MISMATCH ✗'}`);
  console.log('[timings]');
  for (const [k, v] of Object.entries(timings)) {
    console.log(`  ${k.padEnd(20)} ${v.toFixed(1)} ms`);
  }

  await app.close();
  await pool.end();
  process.exitCode = ok ? 0 : 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
