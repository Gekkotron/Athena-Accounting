import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { RpcClient } from './client.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new RpcClient(cfg);
  const server = new McpServer({ name: 'athena-mcp', version: '0.1.0' });
  registerTools(server, client, { statementsDir: cfg.statementsDir });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`[athena-mcp] fatal: ${(err as Error).message}`);
  process.exit(1);
});
