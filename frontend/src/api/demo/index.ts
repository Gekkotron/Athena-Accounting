// Browser-only demo adapter. Same signatures as client.ts's api() and
// apiUpload(), but every call is serviced from a localStorage-backed
// store instead of hitting the backend. Compile-time gated: client.ts
// picks the adapter when import.meta.env.VITE_DEMO === '1'.
//
// Handlers land task-by-task (Task 3 reads, Task 4 writes, Task 5 stubs).
// Until then, unknown paths throw a demo-shaped ApiError so misses are
// loud instead of silent.

import { ApiError } from '../apiError';
import { registerSeedProvider } from './store';
import { buildSeedState } from './seed';

// Register the seed provider at adapter-load time so store.getState()
// (first call, or after reset()) always has a seed to fall back to.
// Handlers land in Task 3+; the map below stays empty for now.
registerSeedProvider(buildSeedState);

export { getState, setState, reset, subscribe, registerSeedProvider } from './store';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DemoRequest {
  method: Method;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export type DemoHandler = (req: DemoRequest) => unknown | Promise<unknown>;

// path (with optional :param placeholders) → per-method handler map.
// Left empty in Task 1; Task 3–5 fill it in.
const handlers: Array<{ method: Method; pattern: RegExp; keys: string[]; handler: DemoHandler }> = [];

export function registerHandler(method: Method, path: string, handler: DemoHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$',
  );
  handlers.push({ method, pattern, keys, handler });
}

function parseInit(path: string, init: RequestInit & { json?: unknown; query?: Record<string, unknown> } | undefined): DemoRequest {
  const method = ((init?.method ?? 'GET') as string).toUpperCase() as Method;
  const query: Record<string, string> = {};
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null || v === '') continue;
      query[k] = String(v);
    }
  }
  const body: unknown = init?.json !== undefined ? init.json : null;
  return { method, path, query, body };
}

function findHandler(req: DemoRequest): { handler: DemoHandler; params: Record<string, string> } | null {
  for (const entry of handlers) {
    if (entry.method !== req.method) continue;
    const match = entry.pattern.exec(req.path);
    if (!match) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(match[i + 1]);
    });
    return { handler: entry.handler, params };
  }
  return null;
}

export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown; query?: Record<string, unknown> },
): Promise<T> {
  const req = parseInit(path, init);
  const found = findHandler(req);
  if (!found) {
    throw new ApiError(`Demo: no handler for ${req.method} ${path}`, 404, { demoMissingHandler: true });
  }
  const result = await Promise.resolve(found.handler({ ...req, query: { ...req.query, ...found.params } }));
  return result as T;
}

// File uploads never succeed in the demo — the seed has no backend to
// parse a statement. Task 5 wires the dedicated stub + modal; until
// then, we throw the same demoStub-shaped error so any early plumbing
// still behaves.
export async function apiUpload<T>(
  path: string,
  _file: File,
  _opts?: { query?: Record<string, unknown> },
): Promise<T> {
  throw new ApiError(
    "Cette fonctionnalité n'est pas disponible dans la démo.",
    501,
    { demoStub: true, path },
  );
}
