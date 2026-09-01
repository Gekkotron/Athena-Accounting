import { describe, it, expect, vi } from 'vitest';
import { subscribe, broadcast } from '../bus.js';

describe('bus', () => {
  it('delivers events only to subscribers of the same userId', () => {
    const a = vi.fn();
    const b = vi.fn();
    const off1 = subscribe(1, a);
    const off2 = subscribe(2, b);
    broadcast(1, { row: { id: 1 } as any });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    off1(); off2();
  });

  it('unsubscribe stops delivery', () => {
    const cb = vi.fn();
    const off = subscribe(3, cb);
    off();
    broadcast(3, { row: { id: 2 } as any });
    expect(cb).not.toHaveBeenCalled();
  });
});
