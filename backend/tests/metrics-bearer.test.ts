import { describe, it, expect } from 'vitest';
import { bearerTokenMatches } from '../src/http/plugins/metrics-auth.js';

describe('bearerTokenMatches', () => {
  const TOKEN = 'super-secret-token-32-chars-please';

  it('accepts an Authorization header with the exact bearer token', () => {
    expect(bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('rejects a missing header', () => {
    expect(bearerTokenMatches(undefined, TOKEN)).toBe(false);
  });

  it('rejects a header without the Bearer prefix', () => {
    expect(bearerTokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerTokenMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it('rejects a supplied token of different length', () => {
    expect(bearerTokenMatches(`Bearer ${TOKEN}extra`, TOKEN)).toBe(false);
    expect(bearerTokenMatches('Bearer short', TOKEN)).toBe(false);
  });

  it('rejects a same-length token that differs in content', () => {
    // Swap the last char so length matches but content doesn't — this is the
    // path the timing-safe compare protects.
    const forged = TOKEN.slice(0, -1) + (TOKEN.at(-1) === 'X' ? 'Y' : 'X');
    expect(forged.length).toBe(TOKEN.length);
    expect(bearerTokenMatches(`Bearer ${forged}`, TOKEN)).toBe(false);
  });
});
