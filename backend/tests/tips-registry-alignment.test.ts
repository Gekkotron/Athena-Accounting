import { describe, it, expect } from 'vitest';
import { TIP_IDS as backendTipIds } from '../src/http/routes/tips/tip-ids.js';

// Import frontend TIP_IDS dynamically to avoid module resolution issues
// during backend tests. The dynamic import ensures we get the actual
// runtime value regardless of how it's constructed.
let frontendTipIds: readonly string[] = [];

describe('tips TIP_IDS backend/frontend alignment', () => {
  it('frontend TIP_IDS array equals backend TIP_IDS array', async () => {
    // Dynamically import the frontend module during test execution
    const frontendContent = await import('../../frontend/src/tips/content.js');
    frontendTipIds = frontendContent.TIP_IDS;

    expect([...frontendTipIds]).toEqual([...backendTipIds]);
  });
});
