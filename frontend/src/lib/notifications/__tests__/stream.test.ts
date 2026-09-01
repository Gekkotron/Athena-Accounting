import { describe, it, expect, vi } from 'vitest';
import { startNotificationsStream } from '../stream.js';

class FakeES {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { (FakeES.instance = this); }
  static instance: FakeES | null = null;
}

describe('stream', () => {
  it('parses events and calls onEvent', () => {
    (globalThis as any).EventSource = FakeES;
    const cb = vi.fn();
    const stop = startNotificationsStream(cb);
    FakeES.instance!.onmessage!({ data: JSON.stringify({ id: 1, kind: 'test', title: 'T', body: 'B', payload: { kind: 'test' }, readAt: null, createdAt: '2026-09-01T00:00:00Z' }) } as any);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 1, kind: 'test' }));
    stop();
    expect(FakeES.instance!.close).toHaveBeenCalled();
  });
});
