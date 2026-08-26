import { db } from './db';
import type { Day, Todo } from './types';
import { uid, now, today } from './store';

/**
 * The unlock rule (spec 5.3) — the single most important behavioural mechanic.
 *
 * A day holds three items. A fourth is not discouraged or warned about, it is
 * IMPOSSIBLE to add in advance: `addToDay` throws once `slots.length` reaches
 * `unlockedCount`, and `unlockedCount` can only grow after the day has already
 * been closed. The invariant is enforced here, in data, rather than by hiding a
 * button — a UI-only rule is one refactor away from being lost.
 *
 * Why it matters: four planned means finishing three is 75%. Three planned with
 * a fourth earned means finishing three is 100% and the fourth is a bonus.
 * Identical work, opposite feeling. Expectation is the only controllable
 * variable, so it must not float upward during the day.
 */

export const STARTING_SLOTS = 3;

export async function getDay(date = today()): Promise<Day | undefined> {
  return db.days.where('date').equals(date).first();
}

/** Days are created lazily — an untouched day is simply absent, not an empty plan. */
export async function ensureDay(date = today()): Promise<Day> {
  const existing = await getDay(date);
  if (existing) return existing;
  const t = now();
  const day: Day = {
    id: uid(),
    date,
    slots: [],
    unlockedCount: STARTING_SLOTS,
    createdAt: t,
    updatedAt: t
  };
  await db.days.add(day);
  return day;
}

export class DayFullError extends Error {
  constructor(unlockedCount: number) {
    super(`Day is full at ${unlockedCount} slots. Close the day to unlock one more.`);
    this.name = 'DayFullError';
  }
}

/**
 * Adds a todo to today's plan. Throws rather than silently trimming, so a bug
 * in a caller surfaces loudly instead of quietly breaking the mechanic.
 */
export async function addToDay(todoId: string, date = today()): Promise<Day> {
  const day = await ensureDay(date);
  if (day.slots.includes(todoId)) return day;
  if (day.slots.length >= day.unlockedCount) throw new DayFullError(day.unlockedCount);
  const slots = [...day.slots, todoId];
  await db.days.update(day.id, { slots, updatedAt: now() });
  return { ...day, slots };
}

/** Skippable without ceremony — no confirmation, no guilt copy (spec 5.2). */
export async function removeFromDay(todoId: string, date = today()): Promise<Day> {
  const day = await ensureDay(date);
  const slots = day.slots.filter((id) => id !== todoId);
  await db.days.update(day.id, { slots, updatedAt: now() });
  return { ...day, slots };
}

/** Replaces one slot in place, preserving order — used by per-slot reshuffle. */
export async function replaceSlot(
  oldTodoId: string,
  newTodoId: string,
  date = today()
): Promise<Day> {
  const day = await ensureDay(date);
  const slots = day.slots.map((id) => (id === oldTodoId ? newTodoId : id));
  await db.days.update(day.id, { slots, updatedAt: now() });
  return { ...day, slots };
}

/**
 * Accepting a Free Time selection. Resets the day to exactly these items at the
 * starting three — a fresh plan never inherits a previously unlocked count.
 */
export async function setDaySlots(todoIds: string[], date = today()): Promise<Day> {
  const day = await ensureDay(date);
  const slots = todoIds.slice(0, STARTING_SLOTS);
  await db.days.update(day.id, {
    slots,
    unlockedCount: STARTING_SLOTS,
    closedAt: undefined,
    updatedAt: now()
  });
  return { ...day, slots, unlockedCount: STARTING_SLOTS, closedAt: undefined };
}

/** How many of the day's slots are done. */
export async function completedInDay(day: Day): Promise<Todo[]> {
  if (day.slots.length === 0) return [];
  const todos = await db.todos.bulkGet(day.slots);
  return todos.filter((t): t is Todo => !!t && !!t.completedAt && !t.deletedAt);
}

/**
 * Call after any completion. The day closes the moment the third slot is done —
 * immediately and successfully, before any "one more?" is offered.
 * Returns true if THIS call closed the day, so the caller knows to show the
 * day-close screen exactly once.
 */
export async function maybeCloseDay(date = today()): Promise<boolean> {
  const day = await getDay(date);
  if (!day || day.closedAt) return false;
  const done = await completedInDay(day);
  if (done.length < STARTING_SLOTS) return false;
  await db.days.update(day.id, { closedAt: now(), updatedAt: now() });
  return true;
}

/**
 * The "one more?" affordance. Only ever available on an already-closed day, and
 * only one at a time — the next one is not visible in advance.
 */
export async function canUnlockOneMore(date = today()): Promise<boolean> {
  const day = await getDay(date);
  if (!day || !day.closedAt) return false;
  return day.slots.length >= day.unlockedCount;
}

export async function unlockOneMore(date = today()): Promise<Day> {
  const day = await ensureDay(date);
  if (!day.closedAt) throw new Error('Cannot unlock before the day is closed.');
  const unlockedCount = day.unlockedCount + 1;
  await db.days.update(day.id, { unlockedCount, updatedAt: now() });
  return { ...day, unlockedCount };
}
