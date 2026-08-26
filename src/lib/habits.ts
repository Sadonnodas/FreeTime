import { db } from './db';
import type { Habit, HabitState, HabitStateChange } from './types';
import { today } from './store';

/**
 * Cycle history and heatmap data (spec 3.6).
 *
 * There is no streak counting anywhere in this file, and there must never be.
 * A streak can only ever tell you that you broke it. A cycle history says
 * "active Jan–Mar · dormant Mar–Aug · active Aug–", which turns "I abandoned
 * guitar again" into "this is the fourth cycle, and they always come back".
 * Same data, opposite message.
 */

export interface Cycle {
  state: HabitState;
  from: string; // ISO
  /** Undefined means "still in it". */
  to?: string;
  /** Logs recorded during this cycle. Descriptive, never a score. */
  logCount: number;
}

/**
 * Turns the state-change log into contiguous ranges.
 *
 * Habits created before the change log existed have no rows, so their first
 * cycle is synthesised from `createdAt`. Without that, an older habit would
 * render an empty history and look broken.
 */
export function buildCycles(
  habit: Habit,
  changes: HabitStateChange[],
  logDates: string[] = []
): Cycle[] {
  const ordered = changes
    .filter((c) => !c.deletedAt && c.habitId === habit.id)
    .sort((a, b) => a.at.localeCompare(b.at));

  const points: { state: HabitState; at: string }[] = ordered.map((c) => ({
    state: c.state,
    at: c.at
  }));

  if (!points.length || points[0]!.at > habit.createdAt) {
    // Everything before the first recorded change was the habit simply existing
    // as it was created — active, since that is the only state createHabit sets.
    points.unshift({ state: 'active', at: habit.createdAt });
  }

  // Collapse consecutive identical states; a repeat is not a new cycle.
  const collapsed = points.filter((p, i) => i === 0 || p.state !== points[i - 1]!.state);

  return collapsed.map((p, i) => {
    const to = collapsed[i + 1]?.at;
    const from = p.at;
    return {
      state: p.state,
      from,
      to,
      logCount: logDates.filter((d) => {
        // Log dates are YYYY-MM-DD; compare on the date part of the boundary.
        const start = from.slice(0, 10);
        const end = to?.slice(0, 10);
        return d >= start && (!end || d < end);
      }).length
    };
  });
}

export interface HabitDetail {
  habit: Habit;
  cycles: Cycle[];
  /** Every date this habit was logged, ascending. */
  logDates: string[];
}

export async function loadHabitDetail(habitId: string): Promise<HabitDetail | null> {
  const habit = await db.habits.get(habitId);
  if (!habit) return null;

  const [changes, logs] = await Promise.all([
    db.habitStateChanges.where('habitId').equals(habitId).toArray(),
    db.habitLogs.where('habitId').equals(habitId).toArray()
  ]);

  const logDates = logs
    .filter((l) => !l.deletedAt)
    .map((l) => l.date)
    .sort();

  return { habit, cycles: buildCycles(habit, changes, logDates), logDates };
}

/**
 * A grid for the calendar heatmap: whole weeks, Monday-first, ending today.
 *
 * Deliberately just "was it logged", with no intensity and no target. A heatmap
 * that shades against a goal is a completion percentage wearing a costume.
 */
export function heatmapWeeks(logDates: string[], weeks = 26): { date: string; on: boolean }[][] {
  const set = new Set(logDates);
  const end = new Date();
  // Walk back to the most recent Sunday so the final column is a full week.
  const offsetToSunday = 6 - ((end.getDay() + 6) % 7);
  end.setDate(end.getDate() + offsetToSunday);

  const days: { date: string; on: boolean }[] = [];
  const cursor = new Date(end);
  cursor.setDate(cursor.getDate() - (weeks * 7 - 1));

  for (let i = 0; i < weeks * 7; i++) {
    const date = today(cursor);
    days.push({ date, on: set.has(date) });
    cursor.setDate(cursor.getDate() + 1);
  }

  const grid: { date: string; on: boolean }[][] = [];
  for (let i = 0; i < days.length; i += 7) grid.push(days.slice(i, i + 7));
  return grid;
}

/** "Jan 2026". Months are the right resolution — a cycle boundary to the day
 *  implies a precision the user did not intend when they tapped a dropdown. */
export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "active Jan 2026 – Mar 2026 · dormant Mar 2026 – Aug 2026 · active Aug 2026 –" */
export function cycleSummary(cycles: Cycle[]): string {
  return cycles
    .map((c) => `${c.state} ${monthLabel(c.from)} – ${c.to ? monthLabel(c.to) : ''}`.trim())
    .join(' · ');
}
