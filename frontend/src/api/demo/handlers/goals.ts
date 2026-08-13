import type { SavingsGoal, SavingsGoalEvent } from '../../types';
import { getState, setState } from '../store';
import { registerHandler, type DemoRequest } from '../index';
import { computeProjection } from '../../../pages/Goals/goal-math';
import { ApiError } from '../../apiError';
import { nextId } from './writes/lib';

const SEED_TODAY = '2026-07-18';

function goalEvents(): SavingsGoalEvent[] {
  return getState().savingsGoalEvents ?? [];
}

function goalsList(): SavingsGoal[] {
  return getState().savingsGoals ?? [];
}

// Rebuild the wire shape from raw store rows: savedAmount is SUM(events),
// projection columns come from the shared math helper.
function hydrateGoal(raw: SavingsGoal, allEvents: SavingsGoalEvent[]): SavingsGoal {
  const acc = getState().accounts.find((a) => a.id === raw.accountId);
  const currency = acc?.currency ?? 'EUR';
  const evs = allEvents.filter((e) => e.goalId === raw.id);
  const saved = evs.reduce((s, e) => s + Number(e.amount), 0);
  const proj = computeProjection({
    target: Number(raw.targetAmount),
    saved,
    targetDate: raw.targetDate,
    todayIso: SEED_TODAY,
  });
  return {
    ...raw,
    currency,
    savedAmount: saved.toFixed(2),
    eventCount: evs.length,
    rawPct: proj.rawPct,
    progressPct: proj.progressPct,
    perMonthNeeded: proj.perMonthNeeded,
    overdueDays: proj.overdueDays,
  };
}

function goalOrThrow(id: number): SavingsGoal {
  const g = goalsList().find((x) => x.id === id);
  if (!g) throw new ApiError('not found', 404, {});
  return g;
}

function handleList(req: DemoRequest) {
  const includeClosed = req.query.includeClosed === '1' || req.query.includeClosed === 'true';
  const all = goalsList().slice().sort((a, b) => {
    // closed_at NULLS FIRST, created_at ASC. Seed doesn't stamp createdAt on
    // goals, so fall back to id order for a stable render.
    const aClosed = a.closedAt ? 1 : 0;
    const bClosed = b.closedAt ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return a.id - b.id;
  });
  const filtered = includeClosed ? all : all.filter((g) => !g.closedAt);
  const evs = goalEvents();
  const goals = filtered.map((g) => hydrateGoal(g, evs));
  const perAccount: Record<number, { savedSum: string }> = {};
  for (const g of goals) {
    if (g.closedAt) continue;
    const cur = perAccount[g.accountId];
    const sum = (cur ? Number(cur.savedSum) : 0) + Number(g.savedAmount);
    perAccount[g.accountId] = { savedSum: sum.toFixed(2) };
  }
  return { goals, perAccount };
}

function handleGet(req: DemoRequest) {
  const g = goalOrThrow(Number(req.query.id));
  return { goal: hydrateGoal(g, goalEvents()) };
}

interface CreateBody {
  accountId: number;
  name: string;
  targetAmount: string;
  targetDate?: string | null;
  color?: string | null;
}

function handleCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<CreateBody>;
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new ApiError('invalid input', 400, {});
  }
  if (!body.targetAmount || Number(body.targetAmount) <= 0) {
    throw new ApiError('invalid input', 400, {});
  }
  const acc = getState().accounts.find((a) => a.id === body.accountId);
  if (!acc) throw new ApiError('not found', 404, {});
  const dup = goalsList().find((g) => g.accountId === body.accountId && g.name === body.name);
  if (dup) throw new ApiError('goal name already exists on this account', 409, {});
  const created: SavingsGoal = {
    id: nextId(goalsList()),
    accountId: body.accountId!,
    name: body.name.trim(),
    targetAmount: body.targetAmount,
    targetDate: body.targetDate ?? null,
    color: body.color ?? null,
    closedAt: null,
    currency: acc.currency,
    savedAmount: '0.00',
    eventCount: 0,
    rawPct: 0,
    progressPct: 0,
    perMonthNeeded: null,
    overdueDays: null,
  };
  setState((s) => { (s.savingsGoals ??= []).push(created); });
  return { goal: hydrateGoal(created, goalEvents()) };
}

function handleUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<CreateBody>;
  let out: SavingsGoal | null = null;
  setState((s) => {
    const list = (s.savingsGoals ??= []);
    const idx = list.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const cur = list[idx]!;
    if (patch.targetAmount != null && Number(patch.targetAmount) <= 0) {
      throw new ApiError('invalid input', 400, {});
    }
    if (patch.name && list.some((g) => g.id !== id && g.accountId === cur.accountId && g.name === patch.name)) {
      throw new ApiError('goal name already exists on this account', 409, {});
    }
    list[idx] = {
      ...cur,
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.targetAmount != null ? { targetAmount: patch.targetAmount } : {}),
      ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate ?? null } : {}),
      ...(patch.color !== undefined ? { color: patch.color ?? null } : {}),
    };
    out = list[idx]!;
  });
  if (!out) throw new ApiError('not found', 404, {});
  return { goal: hydrateGoal(out, goalEvents()) };
}

function handleClose(req: DemoRequest) {
  const id = Number(req.query.id);
  const g = goalOrThrow(id);
  if (g.closedAt) throw new ApiError('goal is already closed', 409, {});
  const now = new Date().toISOString();
  setState((s) => {
    const list = (s.savingsGoals ??= []);
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx]!, closedAt: now };
  });
  return { goal: hydrateGoal({ ...g, closedAt: now }, goalEvents()) };
}

function handleReopen(req: DemoRequest) {
  const id = Number(req.query.id);
  const g = goalOrThrow(id);
  if (!g.closedAt) throw new ApiError('goal is not closed', 409, {});
  setState((s) => {
    const list = (s.savingsGoals ??= []);
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx]!, closedAt: null };
  });
  return { goal: hydrateGoal({ ...g, closedAt: null }, goalEvents()) };
}

function handleDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  goalOrThrow(id);
  setState((s) => {
    s.savingsGoals = (s.savingsGoals ?? []).filter((g) => g.id !== id);
    s.savingsGoalEvents = (s.savingsGoalEvents ?? []).filter((e) => e.goalId !== id);
  });
  return { ok: true };
}

function handleListEvents(req: DemoRequest) {
  const goalId = Number(req.query.id);
  goalOrThrow(goalId);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const before = req.query.before ? Number(req.query.before) : undefined;
  const rows = goalEvents()
    .filter((e) => e.goalId === goalId && (before == null || e.id < before))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
  return { events: rows };
}

function handleCreateEvent(req: DemoRequest) {
  const goalId = Number(req.query.id);
  const g = goalOrThrow(goalId);
  if (g.closedAt) throw new ApiError('goal is closed', 400, {});
  const body = (req.body ?? {}) as { amount?: string; eventDate?: string; note?: string | null };
  if (!body.amount || Number(body.amount) === 0) {
    throw new ApiError('invalid input', 400, {});
  }
  if (!body.eventDate) throw new ApiError('invalid input', 400, {});
  const evs = goalEvents();
  const savedBefore = evs.filter((e) => e.goalId === goalId).reduce((s, e) => s + Number(e.amount), 0);
  const target = Number(g.targetAmount);
  const savedAfter = savedBefore + Number(body.amount);
  const created: SavingsGoalEvent = {
    id: nextId(evs),
    goalId,
    amount: body.amount,
    eventDate: body.eventDate,
    note: body.note ?? null,
    createdAt: new Date().toISOString(),
  };
  setState((s) => { (s.savingsGoalEvents ??= []).push(created); });
  const justReached = savedBefore < target && savedAfter >= target;
  return { event: created, justReached };
}

function handleUpdateEvent(req: DemoRequest) {
  const goalId = Number(req.query.id);
  const eventId = Number(req.query.eventId);
  goalOrThrow(goalId);
  const patch = (req.body ?? {}) as { amount?: string; eventDate?: string; note?: string | null };
  let out: SavingsGoalEvent | null = null;
  setState((s) => {
    const list = (s.savingsGoalEvents ??= []);
    const idx = list.findIndex((e) => e.id === eventId && e.goalId === goalId);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx]!,
      ...(patch.amount != null ? { amount: patch.amount } : {}),
      ...(patch.eventDate != null ? { eventDate: patch.eventDate } : {}),
      ...(patch.note !== undefined ? { note: patch.note ?? null } : {}),
    };
    out = list[idx]!;
  });
  if (!out) throw new ApiError('not found', 404, {});
  return { event: out };
}

function handleDeleteEvent(req: DemoRequest) {
  const goalId = Number(req.query.id);
  const eventId = Number(req.query.eventId);
  goalOrThrow(goalId);
  let removed = false;
  setState((s) => {
    const before = (s.savingsGoalEvents ?? []).length;
    s.savingsGoalEvents = (s.savingsGoalEvents ?? []).filter((e) => !(e.id === eventId && e.goalId === goalId));
    removed = before !== s.savingsGoalEvents.length;
  });
  if (!removed) throw new ApiError('not found', 404, {});
  return { ok: true };
}

export function registerGoalsHandlers(): void {
  registerHandler('GET', '/api/goals', handleList);
  registerHandler('GET', '/api/goals/:id', handleGet);
  registerHandler('POST', '/api/goals', handleCreate);
  registerHandler('PUT', '/api/goals/:id', handleUpdate);
  registerHandler('POST', '/api/goals/:id/close', handleClose);
  registerHandler('POST', '/api/goals/:id/reopen', handleReopen);
  registerHandler('DELETE', '/api/goals/:id', handleDelete);
  registerHandler('GET', '/api/goals/:id/events', handleListEvents);
  registerHandler('POST', '/api/goals/:id/events', handleCreateEvent);
  registerHandler('PUT', '/api/goals/:id/events/:eventId', handleUpdateEvent);
  registerHandler('DELETE', '/api/goals/:id/events/:eventId', handleDeleteEvent);
}
