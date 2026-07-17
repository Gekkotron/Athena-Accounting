import { build } from '../../src/buildServer.js';

export async function buildApp() {
  return await build({ logger: false });
}
