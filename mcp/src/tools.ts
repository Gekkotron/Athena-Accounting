import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { statSync, readFileSync } from 'node:fs';

interface RpcLike { rpc(op: string, args: Record<string, unknown>): Promise<unknown>; }

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const amountStr = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'decimal, up to 2 dp');

const PDF_MAX_BYTES = 10 * 1024 * 1024;

export function readPdfBase64(path: string): string {
  if (!path.toLowerCase().endsWith('.pdf')) throw new Error(`not a .pdf file: ${path}`);
  let stat;
  try { stat = statSync(path); } catch { throw new Error(`file not found: ${path}`); }
  if (!stat.isFile()) throw new Error(`not a file: ${path}`);
  if (stat.size > PDF_MAX_BYTES) throw new Error(`PDF exceeds 10MB: ${path}`);
  return readFileSync(path).toString('base64');
}

export function summarizeSearch(result: unknown): string {
  if (result === null || typeof result !== 'object') return '0 transactions found.';
  const r = result as { transactions?: Array<{ date: string; amount: string }>; pagination?: { total?: number } };
  const txs = r.transactions ?? [];
  if (txs.length === 0) return '0 transactions found.';
  const dates = txs.map((t) => t.date).sort();
  const total = txs.reduce((sum, t) => sum + Number(t.amount), 0);
  const shown = r.pagination?.total ?? txs.length;
  return `${shown} transaction(s), ${dates[0]}–${dates[dates.length - 1]}, shown total ${total.toFixed(2)} €.`;
}

export const TOOL_SPECS = [
  { name: 'list_accounts', op: 'list_accounts', description: 'List accounts with balances and ids.', schema: {} },
  { name: 'list_categories', op: 'list_categories', description: 'List categories with ids and kinds.', schema: {} },
  {
    name: 'search_transactions', op: 'search_transactions',
    description: 'Search/list transactions. Use this to find a transaction id before updating or deleting.',
    schema: {
      search: z.string().optional(),
      accountId: z.number().int().positive().optional(),
      categoryId: z.number().int().positive().optional(),
      fromDate: dateStr.optional(),
      toDate: dateStr.optional(),
      amount: amountStr.optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
  },
  {
    name: 'create_transaction', op: 'create_transaction',
    description: 'Create a transaction. Negative amount = expense, positive = income.',
    schema: {
      accountId: z.number().int().positive(),
      date: dateStr,
      amount: amountStr,
      rawLabel: z.string().min(1).max(512),
      notes: z.string().max(2000).optional(),
      categoryId: z.number().int().positive().optional(),
      lockYears: z.number().int().min(0).max(99).optional(),
    },
  },
  {
    name: 'update_transaction', op: 'update_transaction',
    description: 'Update fields of an existing transaction by id.',
    schema: {
      id: z.number().int().positive(),
      accountId: z.number().int().positive().optional(),
      date: dateStr.optional(),
      amount: amountStr.optional(),
      rawLabel: z.string().min(1).max(512).optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      lockYears: z.number().int().min(0).max(99).nullable().optional(),
    },
  },
  {
    name: 'delete_transaction', op: 'delete_transaction',
    description: 'Delete a transaction by id.',
    schema: { id: z.number().int().positive() },
  },
] as const;

export async function callTool(client: RpcLike, op: string, args: Record<string, unknown>): Promise<unknown> {
  return await client.rpc(op, args);
}

export function registerTools(server: McpServer, client: RpcLike): void {
  for (const spec of TOOL_SPECS) {
    server.tool(spec.name, spec.description, spec.schema as Record<string, z.ZodTypeAny>, async (args: Record<string, unknown>) => {
      try {
        const result = await callTool(client, spec.op, args);
        const text = spec.op === 'search_transactions'
          ? `${summarizeSearch(result)}\n\n${JSON.stringify(result, null, 2)}`
          : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    });
  }

  server.tool(
    'reconcile_statement',
    "Reconcile a bank-statement PDF against Athena. Reads a PDF file on this machine, compares it to recorded transactions, and returns matched/missing/mismatched/extra. Read-only — it never changes data.",
    {
      path: z.string().describe('Absolute path to the statement PDF on this machine'),
      accountId: z.number().int().positive().describe('Athena account id (from list_accounts)'),
      fromDate: dateStr.optional(),
      toDate: dateStr.optional(),
    },
    async (args: Record<string, unknown>) => {
      try {
        const pdfBase64 = readPdfBase64(String(args.path));
        const result = await client.rpc('reconcile_statement', {
          pdfBase64, accountId: args.accountId, fromDate: args.fromDate, toDate: args.toDate,
        }) as { summaryText?: string };
        const text = (result.summaryText ? `${result.summaryText}\n\n` : '') + JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
