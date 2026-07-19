import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const categoryKindEnum = pgEnum('category_kind', [
  'expense',
  'income',
  'transfer',
  'neutral',
]);

export const signConstraintEnum = pgEnum('sign_constraint', [
  'positive',
  'negative',
  'any',
]);

export const matchModeEnum = pgEnum('match_mode', ['word', 'substring', 'regex']);

export const categorySourceEnum = pgEnum('category_source', [
  'manual',
  'auto',
  'default',
  'llm',
]);

export const transferDirectionEnum = pgEnum('transfer_direction', [
  'outgoing',
  'incoming',
]);

export const importFormatEnum = pgEnum('import_format', ['ofx', 'csv', 'pdf']);

export const recurringStatusEnum = pgEnum('recurring_status', [
  'detected',
  'confirmed',
  'dismissed',
]);

export const recurringEssentialnessEnum = pgEnum('recurring_essentialness', [
  'essential',
  'discretionary',
]);

// ---------------------------------------------------------------------------
// users  —  single-user auth (login basique, self-hosted)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// accounts  —  one row per bank account (current, savings, etc.)
//
// opening_balance + opening_date are mandatory: every reported balance is
// computed as opening_balance + SUM(amount WHERE date >= opening_date).
// Multi-currency: each account has its own `currency`; aggregates are reported
// per currency until an explicit FX-rate table is introduced.
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    // Nullable at the Drizzle layer (so legacy code paths that haven't been
    // updated still compile) but enforced NOT NULL at the DB level by
    // migration 0007. Insert sites must supply userId or Postgres rejects.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    openingBalance: numeric('opening_balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    openingDate: date('opening_date').notNull(),
    // User-controlled display order. Lower values appear first; name is the
    // tie-breaker when several rows share the same display_order.
    displayOrder: integer('display_order').notNull().default(0),
    // Optional lock period in years. If set, opening_balance and any
    // transaction without its own lock_years are considered "blocked" until
    // opening_date + lock_years — Dashboard uses this to split "available"
    // vs "blocked" totals. Purely a reporting hint; no hard constraint.
    lockYears: integer('lock_years'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqUserName: uniqueIndex('accounts_user_name_idx').on(t.userId, t.name),
  }),
);

// Map "compte_courant.ofx" → account id. Multiple patterns per account, ranked
// by `priority` (highest first).
export const accountFilenamePatterns = pgTable('account_filename_patterns', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
});

// ---------------------------------------------------------------------------
// categories  —  `kind` powers the sign guard: an income rule won't fire on a
// negative amount, an expense rule won't fire on a positive one.
// One row with is_default=true (`Divers`) is the fallback bucket.
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    // Nullable at the Drizzle layer (so legacy code paths that haven't been
    // updated still compile) but enforced NOT NULL at the DB level by
    // migration 0007. Insert sites must supply userId or Postgres rejects.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: categoryKindEnum('kind').notNull(),
    color: varchar('color', { length: 9 }),
    parentId: integer('parent_id').references((): any => categories.id, {
      onDelete: 'set null',
    }),
    isDefault: boolean('is_default').notNull().default(false),
    // Flags the category as "internal movement" (self-transfer). Aggregates
    // that already skip transactions.transfer_group_id IS NOT NULL now also
    // skip rows tagged with a flagged category — covers users who don't rely
    // on the auto mirror-leg detector and instead tag one side manually.
    isInternalTransfer: boolean('is_internal_transfer').notNull().default(false),
  },
  (t) => ({
    uqUserParentName: uniqueIndex('categories_user_parent_name_idx').on(
      t.userId,
      sql`COALESCE(${t.parentId}, 0)`,
      t.name,
    ),
  }),
);

// ---------------------------------------------------------------------------
// category_budgets  —  Spending-cap mode ("Plafonds"). Envelope-mode data lives in envelope_* tables.
// One recurring spending limit per expense category (migration 0015). Two partial unique indexes (migration 0021) enforce
// uniqueness on (user_id, category_id, period) for global budgets
// (account_id IS NULL) and (user_id, category_id, period, account_id) for
// per-account budgets.
// ---------------------------------------------------------------------------

export const categoryBudgets = pgTable(
  'category_budgets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    monthlyLimit: numeric('monthly_limit', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    // v2 additions (migration 0021):
    //  - `period` widens `monthlyLimit` from "monthly cap" to "period target".
    //    The DB column name and JSON key stay `monthly_limit` / `monthlyLimit`
    //    for backup/restore compatibility.
    //  - `accountId` NULL = global (all accounts); non-NULL = scoped.
    period: text('period').notNull().default('monthly'),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqGlobal: uniqueIndex('category_budgets_global_uniq')
      .on(t.userId, t.categoryId, t.period)
      .where(sql`account_id IS NULL`),
    uqScoped: uniqueIndex('category_budgets_scoped_uniq')
      .on(t.userId, t.categoryId, t.period, t.accountId)
      .where(sql`account_id IS NOT NULL`),
  }),
);

// ---------------------------------------------------------------------------
// envelope_assignments  —  per-month allocation per category. Under the
// envelope model, income is allocated forward one month at a time.
// ---------------------------------------------------------------------------

export const envelopeAssignments = pgTable(
  'envelope_assignments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('envelope_assignments_user_cat_month_uq')
      .on(t.userId, t.categoryId, t.month),
    byUserMonth: index('envelope_assignments_user_month_idx')
      .on(t.userId, t.month),
  }),
);

// ---------------------------------------------------------------------------
// envelope_category_settings  —  per-envelope configuration: optional target
// and overspend policy. Row exists only when user configures something.
// ---------------------------------------------------------------------------

export const envelopeCategorySettings = pgTable(
  'envelope_category_settings',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    targetAmount: numeric('target_amount', { precision: 14, scale: 2 }),
    targetDate: date('target_date'),
    targetKind: text('target_kind'),
    overspendPolicy: text('overspend_policy').notNull().default('rollover_negative'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.categoryId] }) }),
);

// ---------------------------------------------------------------------------
// envelope_month_holds  —  "hold for next month" buffer. A hold on month M
// deducts from month M's pool and releases into month M+1's pool.
// ---------------------------------------------------------------------------

export const envelopeMonthHolds = pgTable(
  'envelope_month_holds',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.month] }) }),
);

// ---------------------------------------------------------------------------
// rules  —  rule engine. match_mode='word' is the default and prevents
// "paye" from matching "payweb"; matching is accent/case-insensitive thanks
// to an index on immutable_unaccent(lower(keyword)).
// ---------------------------------------------------------------------------

export const rules = pgTable(
  'rules',
  {
    id: serial('id').primaryKey(),
    // Nullable at the Drizzle layer (so legacy code paths that haven't been
    // updated still compile) but enforced NOT NULL at the DB level by
    // migration 0007. Insert sites must supply userId or Postgres rejects.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    keyword: text('keyword').notNull(),
    signConstraint: signConstraintEnum('sign_constraint').notNull().default('any'),
    matchMode: matchModeEnum('match_mode').notNull().default('word'),
    priority: integer('priority').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxPriority: index('rules_priority_idx').on(t.priority),
  }),
);

// Separate from `rules`: a transfer rule does not assign a category — it
// annotates a transaction as one leg of an internal transfer and links it to
// its mirror leg in the counterpart account via `transfer_group_id`.
export const transferRules = pgTable('transfer_rules', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  keyword: text('keyword').notNull(),
  direction: transferDirectionEnum('direction').notNull(),
  counterpartAccountId: integer('counterpart_account_id').references(
    () => accounts.id,
    { onDelete: 'set null' },
  ),
  enabled: boolean('enabled').notNull().default(true),
});

// ---------------------------------------------------------------------------
// file_imports  —  audit row per uploaded file. Lets the UI explain "this
// import inserted 0 transactions because every row was already in the DB".
// ---------------------------------------------------------------------------

export const fileImports = pgTable('file_imports', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  format: importFormatEnum('format').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  totalLines: integer('total_lines').notNull(),
  insertedCount: integer('inserted_count').notNull(),
  dedupSkipped: integer('dedup_skipped').notNull(),
  // Closing balance printed on the statement + the date that balance is "as of".
  // Optional — set when the user reconciles the import against the bank's PDF.
  statedBalance: numeric('stated_balance', { precision: 14, scale: 2 }),
  statedBalanceDate: date('stated_balance_date'),
});

// ---------------------------------------------------------------------------
// transactions  —  one row per leg.
// An internal transfer is two rows (one per account) linked by
// `transfer_group_id`. This keeps per-account balances as a plain SUM(amount)
// and excludes transfers from expense/income aggregates via
// `WHERE transfer_group_id IS NULL`.
//
// `dedup_key` is FITID when present, else sha1(account|date|amount|normalized_label).
// UNIQUE(account_id, dedup_key) makes re-imports idempotent at the DB level.
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Nullable at the Drizzle layer (so legacy code paths that haven't been
    // updated still compile) but enforced NOT NULL at the DB level by
    // migration 0007. Insert sites must supply userId or Postgres rejects.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    rawLabel: text('raw_label').notNull(),
    normalizedLabel: text('normalized_label').notNull(),
    memo: text('memo'),
    notes: text('notes'),
    fitid: text('fitid'),
    dedupKey: text('dedup_key').notNull(),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    categorySource: categorySourceEnum('category_source').notNull().default('auto'),
    transferGroupId: uuid('transfer_group_id'),
    sourceFileId: integer('source_file_id').references(() => fileImports.id, {
      onDelete: 'set null',
    }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    // True when the user has reviewed the row in the "Possibles doublons" panel
    // and confirmed it is NOT a duplicate of its same-date/same-amount neighbours.
    notDuplicate: boolean('not_duplicate').notNull().default(false),
    // Per-transaction lock override. Clocked from the transaction date (unlike
    // the account default which is clocked from opening_date). Null falls back
    // to the account's lock_years, and null there means no lock at all.
    lockYears: integer('lock_years'),
  },
  (t) => ({
    uqDedup: uniqueIndex('transactions_account_dedup_uq').on(t.accountId, t.dedupKey),
    idxAccountDate: index('transactions_account_date_idx').on(t.accountId, t.date),
    idxTransferGroup: index('transactions_transfer_group_idx').on(t.transferGroupId),
    idxCategory: index('transactions_category_idx').on(t.categoryId),
  }),
);

// ---------------------------------------------------------------------------
// pdf_statement_templates — one row per learned bank layout, keyed by
// content fingerprint (SHA-256 of PDF text items).
// ---------------------------------------------------------------------------

export const pdfStatementTemplates = pgTable(
  'pdf_statement_templates',
  {
    id: serial('id').primaryKey(),
    // Nullable for legacy rows from before migration 0007 — those stay around
    // but the per-user lookup won't pick them up.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    // Nullable for legacy rows created before migration 0006. The orchestrator
    // requires a non-null accountId match for the auto-apply path.
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    zones: jsonb('zones').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqFingerprintAccount: uniqueIndex('pdf_statement_templates_fingerprint_account_idx')
      .on(t.fingerprint, t.accountId),
  }),
);

// ---------------------------------------------------------------------------
// pdf_import_drafts — parked uploads, expires after 24 hours.
// The user paints zones on the UI, which fires a POST to finalize the template.
// ---------------------------------------------------------------------------

export const pdfImportDrafts = pgTable(
  'pdf_import_drafts',
  {
    id: serial('id').primaryKey(),
    // Nullable at the Drizzle layer (so legacy code paths that haven't been
    // updated still compile) but enforced NOT NULL at the DB level by
    // migration 0007. Insert sites must supply userId or Postgres rejects.
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    pdfBytes: text('pdf_bytes').notNull(),
    textItems: jsonb('text_items').notNull(),
    fingerprint: text('fingerprint').notNull(),
    sourceKind: text('source_kind').notNull().default('pdf'),
    ocrStatus: text('ocr_status').notNull().default('not_needed'),
    ocrProgress: integer('ocr_progress').notNull().default(0),
    ocrTotal: integer('ocr_total').notNull().default(0),
    ocrError: text('ocr_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => ({
    idxExpires: index('pdf_import_drafts_expires_at_idx').on(t.expiresAt),
  }),
);

// ---------------------------------------------------------------------------
// balance_checkpoints — manual reconciliation markers per account.
// Displayed as diamonds on the Dashboard chart when a specific account is
// scoped; drifts against the computed cumulative render in an amber style.
// ---------------------------------------------------------------------------

export const balanceCheckpoints = pgTable(
  'balance_checkpoints',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    checkpointDate: date('checkpoint_date').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 14, scale: 2 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqAccountDate: uniqueIndex('balance_checkpoints_account_date_uq').on(
      t.accountId,
      t.checkpointDate,
    ),
    idxAccount: index('balance_checkpoints_account_idx').on(t.accountId),
    idxUser: index('balance_checkpoints_user_idx').on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// user_settings — per-user configurable defaults. JSONB blob so adding
// future keys does not require a schema migration. The Zod schema at
// backend/src/domain/settings/schema.ts is the source of truth for shape.
// ---------------------------------------------------------------------------

export const userSettings = pgTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default({}),
  dismissedTips: jsonb('dismissed_tips')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  mcpEnabled: boolean('mcp_enabled').notNull().default(false),
  mcpKeyWrapped: text('mcp_key_wrapped'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// recurring_series — detected recurring transaction patterns (migration 0027).
// The detector groups a user's transactions by (fuzzy label similarity,
// cadence bucket, amount tolerance) and emits one row here per repeating
// pattern. Users can Confirm/Dismiss the detection and tag a series as
// essential vs discretionary; those decisions are preserved across
// regenerate runs.
// ---------------------------------------------------------------------------

export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    cadenceDays: integer('cadence_days').notNull(),
    avgAmount: numeric('avg_amount', { precision: 14, scale: 2 }).notNull(),
    amountStddev: numeric('amount_stddev', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    firstSeenAt: date('first_seen_at').notNull(),
    lastSeenAt: date('last_seen_at').notNull(),
    nextDueAt: date('next_due_at').notNull(),
    status: recurringStatusEnum('status').notNull().default('detected'),
    essentialness: recurringEssentialnessEnum('essentialness'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqUserLabelCadence: uniqueIndex('recurring_series_user_label_cadence_uq').on(
      t.userId,
      t.label,
      t.cadenceDays,
    ),
    idxUserStatus: index('recurring_series_user_status_idx').on(t.userId, t.status),
    idxNextDue: index('recurring_series_next_due_idx').on(t.userId, t.nextDueAt),
  }),
);

// Join table: which transactions contributed to each series. Cascades
// both ways so a series drop or a transaction delete keeps the graph
// consistent without needing manual cleanup.
export const recurringSeriesTransactions = pgTable(
  'recurring_series_transactions',
  {
    seriesId: integer('series_id')
      .notNull()
      .references(() => recurringSeries.id, { onDelete: 'cascade' }),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.seriesId, t.transactionId] }),
    idxTx: index('recurring_series_transactions_tx_idx').on(t.transactionId),
  }),
);

// ---------------------------------------------------------------------------
// transaction_splits — ventilation of one transaction across N (>= 2)
// categories. Sum-of-amounts must equal parent.amount, enforced by a
// deferrable trigger installed in migration 0014. Ownership derived
// transitively via transaction_id (no user_id column needed).
// ---------------------------------------------------------------------------

export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: serial('id').primaryKey(),
    transactionId: bigint('transaction_id', { mode: 'number' })
      .notNull(),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    memo: text('memo'),
  },
  (t) => ({
    idxTx:  index('transaction_splits_tx_idx').on(t.transactionId),
    idxCat: index('transaction_splits_cat_idx').on(t.categoryId),
  }),
);
