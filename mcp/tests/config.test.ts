import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const dirs: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'mcp-config-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const base = { ATHENA_MCP_USER: 'alice', ATHENA_MCP_TOKEN: 'x'.repeat(20) };

describe('loadConfig', () => {
  it('uses ATHENA_API_URL when set and strips trailing slash', () => {
    const cfg = loadConfig({ ...base, ATHENA_API_URL: 'http://host:8001/' });
    expect(cfg.apiUrl).toBe('http://host:8001');
  });

  it('falls back to ATHENA_PORT_FILE for Tauri mode', () => {
    const d = mkTmp();
    const f = path.join(d, '.mcp-port');
    writeFileSync(f, '54321\n');
    const cfg = loadConfig({ ...base, ATHENA_PORT_FILE: f });
    expect(cfg.apiUrl).toBe('http://127.0.0.1:54321');
  });

  it('prefers ATHENA_API_URL over ATHENA_PORT_FILE when both are set', () => {
    const d = mkTmp();
    const f = path.join(d, '.mcp-port');
    writeFileSync(f, '54321\n');
    const cfg = loadConfig({ ...base, ATHENA_API_URL: 'http://host:8001', ATHENA_PORT_FILE: f });
    expect(cfg.apiUrl).toBe('http://host:8001');
  });

  it('throws when neither URL nor port file is provided', () => {
    expect(() => loadConfig({ ...base })).toThrow(/ATHENA_API_URL or ATHENA_PORT_FILE/);
  });

  it('throws on a malformed port file', () => {
    const d = mkTmp();
    const f = path.join(d, '.mcp-port');
    writeFileSync(f, 'not-a-port\n');
    expect(() => loadConfig({ ...base, ATHENA_PORT_FILE: f })).toThrow(/valid port/);
  });

  it('throws on out-of-range port', () => {
    const d = mkTmp();
    const f = path.join(d, '.mcp-port');
    writeFileSync(f, '99999\n');
    expect(() => loadConfig({ ...base, ATHENA_PORT_FILE: f })).toThrow(/valid port/);
  });
});
