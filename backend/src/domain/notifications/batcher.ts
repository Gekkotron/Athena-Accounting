import type { NotificationKind, NotificationPayload } from './types.js';
import { emitNotification } from './emit.js';

export const IDLE_MS = 2000;
export const MAX_ITEMS = 10;

type EmitFn = (uid: number, k: NotificationKind, p: NotificationPayload, o?: { idempotency?: string }) => Promise<unknown>;
let emitter: EmitFn = emitNotification;
export function __setEmitter(fn: EmitFn) { emitter = fn; }

type Buffer = { items: { accountId: number; amount: number }[]; timer: ReturnType<typeof setTimeout> | null };
const buffers = new Map<string, Buffer>();
const key = (uid: number, batchKey: string) => `${uid}::${batchKey}`;

export function queueBatched(userId: number, batchKey: string, item: { accountId: number; amount: number }): void {
  const k = key(userId, batchKey);
  let buf = buffers.get(k);
  if (!buf) { buf = { items: [], timer: null }; buffers.set(k, buf); }
  buf.items.push(item);
  if (buf.timer) clearTimeout(buf.timer);
  if (buf.items.length >= MAX_ITEMS) { void flushBatch(userId, batchKey); return; }
  buf.timer = setTimeout(() => { void flushBatch(userId, batchKey); }, IDLE_MS);
}

export async function flushBatch(userId: number, batchKey: string): Promise<void> {
  const k = key(userId, batchKey);
  const buf = buffers.get(k);
  if (!buf) return;
  buffers.delete(k);
  if (buf.timer) clearTimeout(buf.timer);
  if (buf.items.length === 0) return;
  const accountId = buf.items[0]!.accountId;
  const total = buf.items.reduce((s, i) => s + i.amount, 0);
  const idempotency = `bt:${accountId}:${new Date().toISOString().slice(0, 10)}:${Date.now()}`;
  await emitter(userId, 'big_transaction', { kind: 'big_transaction', summary: { accountId, count: buf.items.length, total } }, { idempotency });
}
