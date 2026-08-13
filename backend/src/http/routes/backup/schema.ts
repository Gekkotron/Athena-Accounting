import { z } from 'zod';

// Versioned envelope. Bump `version` when the shape changes in a non-additive
// way — the importer refuses unknown versions outright.
//
// Transaction attachments (migration 0034) are DELIBERATELY NOT included in
// the backup dump. Each attachment can be up to 10 MB and files accumulate
// with normal use; inlining them as base64 would inflate the JSON envelope
// by orders of magnitude (and by the encryption cost multiplier under the
// passphrase-encrypted export flow). The intended workflow is: back up
// DATA_DIR/attachments/ alongside the JSON dump using the user's own
// filesystem tooling. The dump file is small and text-diffable; the on-disk
// attachments directory is a self-contained blob store. On restore the
// attachment rows cascade-delete with their parent transactions and the
// user's DATA_DIR/attachments/ files become orphans until the user replaces
// them from their filesystem-level backup (documented in Task 3).
export const VERSION = 4;

const categoryKind = z.enum(['expense', 'income', 'transfer', 'neutral']);
const signConstraint = z.enum(['positive', 'negative', 'any']);
const matchMode = z.enum(['word', 'substring', 'regex']);
const categorySource = z.enum(['manual', 'auto', 'default', 'llm']);

export const BackupBody = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  accounts: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      currency: z.string(),
      openingBalance: z.string(),
      openingDate: z.string(),
      // Added later; optional so older backups that omit it still validate.
      // Missing displayOrder defaults to 0 on import.
      displayOrder: z.number().int().optional(),
      // Lock-period default (migration 0011). Optional for backward compat.
      lockYears: z.number().int().min(0).max(99).nullable().optional(),
      // Legacy field (migration 0017, dropped in 0018). Kept optional so v2
      // backups still validate; the importer translates isInvestment=true
      // into type='investment' before insert.
      isInvestment: z.boolean().optional(),
    }),
  ),
  categories: z.array(
    z.object({
      name: z.string(),
      kind: categoryKind,
      color: z.string().nullable().optional(),
      parent: z.string().nullable().optional(),
      isDefault: z.boolean(),
      // Added in migration 0012. Optional so pre-0012 backups still validate;
      // missing means "false" (existing behaviour).
      isInternalTransfer: z.boolean().optional(),
    }),
  ),
  accountFilenamePatterns: z.array(
    z.object({
      pattern: z.string(),
      account: z.string().nullable(),
      priority: z.number().int(),
    }),
  ),
  rules: z.array(
    z.object({
      keyword: z.string(),
      category: z.string().nullable(),
      // Disambiguates same-name sub-categories under different parents
      // (migration 0019's unique index scopes on parent). Absent on v3 and
      // older dumps; null means "root category" on v4+ dumps.
      categoryParent: z.string().nullable().optional(),
      signConstraint,
      matchMode,
      priority: z.number().int(),
      enabled: z.boolean(),
    }),
  ),
  // (transferRules were dropped as a feature — any legacy field on an old dump
  // is silently stripped by zod's default .strip() behavior on parse.)
  // Per-account balance checkpoints (migration 0009). Optional for
  // backward compatibility with pre-fix exports that omit the field.
  balanceCheckpoints: z.array(
    z.object({
      account: z.string(),
      checkpointDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      expectedAmount: z.string(),
      note: z.string().nullable().optional(),
    }),
  ).optional(),
  transactions: z.array(
    z.object({
      account: z.string(),
      date: z.string(),
      amount: z.string(),
      rawLabel: z.string(),
      normalizedLabel: z.string(),
      memo: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      fitid: z.string().nullable().optional(),
      dedupKey: z.string(),
      category: z.string().nullable().optional(),
      // See `rules[].categoryParent` above.
      categoryParent: z.string().nullable().optional(),
      categorySource,
      transferGroupId: z.string().nullable().optional(),
      // Natural-key reference to a fileImports row in the same backup.
      // Shape: "<filename>|<importedAt-ISO>". Missing means "no source file".
      sourceFileKey: z.string().nullable().optional(),
      // Validated as "not a duplicate" via the Possibles doublons panel.
      // Optional for backward compatibility with pre-fix exports.
      notDuplicate: z.boolean().optional(),
      // Per-transaction lock override (migration 0011). Optional for
      // backward compatibility.
      lockYears: z.number().int().min(0).max(99).nullable().optional(),
      // Ventilation across categories (migration 0014). Optional so v1
      // backups without splits still validate.
      splits: z.array(
        z.object({
          category: z.string().nullable(),
          // See `rules[].categoryParent` above.
          categoryParent: z.string().nullable().optional(),
          amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
          memo: z.string().nullable().optional(),
        }),
      ).optional(),
    }),
  ),
  // Audit trail of past imports — the rows that power the Imports → Historique
  // table. Optional for backward compatibility with pre-fix exports.
  fileImports: z.array(
    z.object({
      account: z.string(),
      filename: z.string(),
      format: z.enum(['ofx', 'csv', 'pdf']),
      importedAt: z.string(),
      totalLines: z.number().int(),
      insertedCount: z.number().int(),
      dedupSkipped: z.number().int(),
      statedBalance: z.string().nullable().optional(),
      statedBalanceDate: z.string().nullable().optional(),
    }),
  ).optional(),
  // Category budgets (migration 0015; period + account added in 0021).
  // Optional so pre-0015 backups still validate. Referenced by category name;
  // restore skips a budget whose category did not restore.
  // `period` and `account` are v2 additions; both optional so pre-v2 backups
  // still validate (defaults: 'monthly' / null).
  budgets: z.array(
    z.object({
      category: z.string().nullable(),
      // See `rules[].categoryParent` above.
      categoryParent: z.string().nullable().optional(),
      monthlyLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).refine((s) => Number(s) > 0, 'must be greater than 0'),
      currency: z.string(),
      period: z.enum(['monthly', 'yearly']).optional().default('monthly'),
      account: z.string().nullable().optional(), // account name; null = global
    }),
  ).optional(),
});

export type BackupDump = z.infer<typeof BackupBody>;

// Natural key for cross-referencing a fileImports row from a transaction —
// exports emit `sourceFileKey: "<filename>|<importedAt-ISO>"` so restore can
// re-link transactions to file_imports even though DB ids get regenerated.
export function fileImportKey(filename: string, importedAtISO: string): string {
  return `${filename}|${importedAtISO}`;
}
