import { describe, it, expect } from 'vitest';
import { ListQuery } from '../schemas.js';

describe('ListQuery', () => {
  it('parses type as a tri-state enum', () => {
    const ok = ListQuery.safeParse({ type: 'expense' });
    expect(ok.success && ok.data.type).toBe('expense');
    const bad = ListQuery.safeParse({ type: 'nope' });
    expect(bad.success).toBe(false);
  });

  it('coerces uncategorized from the "true" string that query strings carry', () => {
    const strTrue = ListQuery.safeParse({ uncategorized: 'true' });
    expect(strTrue.success && strTrue.data.uncategorized).toBe(true);
    const strFalse = ListQuery.safeParse({ uncategorized: 'false' });
    expect(strFalse.success && strFalse.data.uncategorized).toBe(false);
    const missing = ListQuery.safeParse({});
    expect(missing.success && missing.data.uncategorized).toBeUndefined();
  });
});
