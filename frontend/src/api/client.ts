// Thin fetch wrapper. The frontend is served from the same origin as /api (via
// nginx proxy in prod, vite proxy in dev) so we can use a relative base path
// and rely on the session cookie traveling automatically.
export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown; query?: Record<string, unknown> },
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers = new Headers(init?.headers);
  let body: BodyInit | undefined = init?.body ?? undefined;
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url.pathname + url.search, {
    credentials: 'include',
    ...init,
    headers,
    body,
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string')
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

// Multipart upload helper for file imports.
export async function apiUpload<T>(
  path: string,
  file: File,
  opts?: { query?: Record<string, unknown> },
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(url.pathname + url.search, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string')
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}
