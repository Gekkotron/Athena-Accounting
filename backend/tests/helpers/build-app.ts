import { build } from '../../src/server.js';

export async function buildApp() {
  return await build({ logger: false });
}
