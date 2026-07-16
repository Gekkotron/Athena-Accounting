import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TIP_IDS } from '../src/http/routes/tips/tip-ids.js';

// This test guarantees that the frontend and backend agree on the set
// and order of tip ids. If they drift, either side would happily let
// through a malformed value; the frontend would then try to dismiss a
// tip the backend rejects (400), or vice versa.
describe('tips TIP_IDS backend/frontend alignment', () => {
  it('frontend TIP_IDS array equals backend TIP_IDS array', () => {
    const frontendPath = resolve(
      __dirname,
      '..',
      '..',
      'frontend',
      'src',
      'tips',
      'content.ts',
    );
    const src = readFileSync(frontendPath, 'utf-8');

    // Extract the array literal between `export const TIP_IDS = [` and `] as const;`
    const match = src.match(/export const TIP_IDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
    expect(match, 'TIP_IDS export not found in frontend/src/tips/content.ts').not.toBeNull();

    const items = match![1]
      .split(/,/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.replace(/^['"]|['"]$/g, ''));

    expect(items).toEqual([...TIP_IDS]);
  });
});
