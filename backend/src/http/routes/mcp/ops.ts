export type BuiltOp = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  query?: Record<string, string>;
  payload?: unknown;
};

export class UnknownOpError extends Error {
  constructor(op: string) { super(`unknown op: ${op}`); this.name = 'UnknownOpError'; }
}

const SEARCH_KEYS = ['accountId', 'categoryId', 'sourceFileId', 'fromDate', 'toDate', 'minAmount', 'maxAmount', 'amount', 'search', 'includeTransfers', 'sort', 'order', 'limit', 'offset'] as const;

export function buildOp(op: string, args: Record<string, unknown>): BuiltOp {
  switch (op) {
    case 'list_accounts':
      return { method: 'GET', url: '/api/accounts' };
    case 'list_categories':
      return { method: 'GET', url: '/api/categories' };
    case 'search_transactions': {
      const query: Record<string, string> = {};
      for (const k of SEARCH_KEYS) {
        const v = args[k];
        if (v !== undefined && v !== null) query[k] = String(v);
      }
      return { method: 'GET', url: '/api/transactions', query };
    }
    case 'create_transaction':
      return { method: 'POST', url: '/api/transactions', payload: args };
    case 'update_transaction': {
      const { id, ...rest } = args as { id?: unknown };
      // encodeURIComponent prevents a crafted id (e.g. "5/splits") from
      // making the injected request route to a *different* registered
      // endpoint (fastify/find-my-way splits on literal "/" before
      // decoding percent-escapes) — this op must only ever hit
      // /api/transactions/:id, never a sibling sub-route.
      return { method: 'PATCH', url: `/api/transactions/${encodeURIComponent(String(id))}`, payload: rest };
    }
    case 'delete_transaction': {
      const { id } = args as { id?: unknown };
      return { method: 'DELETE', url: `/api/transactions/${encodeURIComponent(String(id))}` };
    }
    case 'reconcile_statement':
      return { method: 'POST', url: '/api/reconcile', payload: args };
    default:
      throw new UnknownOpError(op);
  }
}
