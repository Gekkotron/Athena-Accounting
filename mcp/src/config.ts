export interface Config { apiUrl: string; user: string; token: string; }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const apiUrl = env.ATHENA_API_URL ?? (missing.push('ATHENA_API_URL'), '');
  const user = env.ATHENA_MCP_USER ?? (missing.push('ATHENA_MCP_USER'), '');
  const token = env.ATHENA_MCP_TOKEN ?? (missing.push('ATHENA_MCP_TOKEN'), '');
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  return { apiUrl: apiUrl.replace(/\/$/, ''), user, token };
}
