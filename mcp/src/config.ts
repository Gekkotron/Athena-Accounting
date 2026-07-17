import { readFileSync } from 'node:fs';

export interface Config { apiUrl: string; user: string; token: string; statementsDir?: string; }

// Resolve the Athena backend URL. In the Docker/LAN path users set
// `ATHENA_API_URL` directly (stable host + fixed port). In the Tauri desktop
// path the backend binds to a random loopback port on every launch, so the
// desktop entry writes that port to `${DATA_DIR}/.mcp-port` and the user's
// MCP client config points at that file via `ATHENA_PORT_FILE`. The file
// contains a single line: the port number.
function resolveApiUrl(env: NodeJS.ProcessEnv): string | null {
  const direct = env.ATHENA_API_URL;
  if (direct) return direct.replace(/\/$/, '');
  const portFile = env.ATHENA_PORT_FILE;
  if (!portFile) return null;
  const raw = readFileSync(portFile, 'utf8').trim();
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`ATHENA_PORT_FILE ${portFile} did not contain a valid port (got ${JSON.stringify(raw)})`);
  }
  return `http://127.0.0.1:${port}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const apiUrl = resolveApiUrl(env);
  if (!apiUrl) missing.push('ATHENA_API_URL or ATHENA_PORT_FILE');
  const user = env.ATHENA_MCP_USER ?? (missing.push('ATHENA_MCP_USER'), '');
  const token = env.ATHENA_MCP_TOKEN ?? (missing.push('ATHENA_MCP_TOKEN'), '');
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  const statementsDir = env.ATHENA_STATEMENTS_DIR;
  return {
    apiUrl: apiUrl!, user, token,
    ...(statementsDir ? { statementsDir } : {}),
  };
}
