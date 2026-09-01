import type { Notification } from '../../../../shared/api-contracts.js';

export type BusEvent = { row: Notification };
type Sub = (e: BusEvent) => void;

const subs = new Map<number, Set<Sub>>();

export function subscribe(userId: number, cb: Sub): () => void {
  let set = subs.get(userId);
  if (!set) { set = new Set(); subs.set(userId, set); }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subs.delete(userId);
  };
}

export function broadcast(userId: number, e: BusEvent): void {
  const set = subs.get(userId);
  if (!set) return;
  for (const cb of set) {
    try { cb(e); } catch { /* swallow; a broken subscriber must not block peers */ }
  }
}
