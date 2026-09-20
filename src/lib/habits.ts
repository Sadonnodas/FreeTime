import { db } from './db';
import type { Habit, HabitState, HabitStateChange } from './types';
import { today, PROJECT_COLORS } from './store';
import { weekStart } from './days';

/**
 * Cycle history and heatmap data (spec 3.6).
 *
 * There is no streak counting anywhere in this file, and there must never be.
 * A streak can only ever tell you that you broke it. A cycle history says
 * "active Jan–Mar · dormant Mar–Aug · active Aug–", which turns "I abandoned
 * guitar again" into "this is the fourth cycle, and they always come back".
 * Same data, opposite message.
 */

/**
 * A habit's colour: the one chosen, or one derived from its id.
 *
 * Asked for as *"they look bland while they should look inviting"* — habits
 * were the only grey things left on Today. Derived from the ID, not the name
 * or the position, so renaming or reordering one does not repaint it and two
 * devices always agree.
 */
export function habitColor(habit: Pick<Habit, 'id' | 'color'>): string {
  if (habit.color) return habit.color;
  let h = 0;
  for (const ch of habit.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

/** Text that reads on a filled palette colour, in either theme. */
export const ON_COLOR = '#161616';

// ------------------------------------------------------- a weekly rhythm

/**
 * SOME HABITS ARE NOT DAILY ONES, and the app used to have no way to say so.
 *
 * Asked for as *"a way to track weekly habits (e.g. 3 times a week) without
 * specific days"*. Every habit showed on Today every day, so one meant three
 * times a week sat there un-ticked on the other four — which is an overdue
 * state arriving by accident, in the one app that promises never to have one.
 *
 * `Habit.timesPerWeek` is that sentence written down. WHAT MAKES IT A RHYTHM
 * AND NOT A TARGET is everything it is not allowed to do, and these rules are
 * load-bearing rather than styling:
 *
 * - **Nothing ever counts what is left.** There is no "1 to go", no bar, no
 *   fraction on any screen. What is shown is what has happened — "2 this
 *   week" — which is the same argument that lets the fortnight of dots and the
 *   "where the work went" chart exist.
 * - **A week that came up short is never mentioned.** Monday starts again in
 *   silence; nothing looks back at last week's count, and the weekly look-back
 *   keeps its own rule ("habits as days, never out of 7").
 * - **The number is only ever the one you typed.** The app never infers a
 *   rhythm from how often something happens to get logged — that is the same
 *   judgement the old habit tracker made and lost trust over, and it is why
 *   dormant is an explicit choice too.
 * - **Meeting it is the ONLY thing it changes.** A habit whose rhythm is met
 *   stops asking for the rest of the week: it settles to the end of the row
 *   and drops out of the wave. That is the whole feature — permission to stop,
 *   not a score to chase.
 *
 * "Out of 3" is deliberately never rendered, and the difference from the
 * banned "out of 7" is where the denominator came from: seven is a number the
 * app would be inventing on your behalf, three is one you set. That is the
 * argument to check anything new here against.
 */
export const RHYTHM_CHOICES = [1, 2, 3, 4, 5, 6];

/** "Most days" — what a habit with no rhythm set is. */
export function rhythmLabel(timesPerWeek?: number): string {
  if (!timesPerWeek) return 'Most days';
  if (timesPerWeek === 1) return 'Once a week';
  if (timesPerWeek === 2) return 'Twice a week';
  return `${timesPerWeek} times a week`;
}

/** The short form for a row that is already carrying other facts. */
export function rhythmShort(timesPerWeek?: number): string | undefined {
  return timesPerWeek ? `${timesPerWeek}× a week` : undefined;
}

/** How many of `logDates` fall in the week containing `on`, Monday-first. */
export function timesThisWeek(logDates: string[], on: Date = new Date()): number {
  const from = today(weekStart(on));
  const to = today(on);
  // Only up to today: a log dated later in the week is somebody else's clock
  // or a correction, and counting it would say the rhythm was met before it
  // was. Deduplicated, because two devices can each write the same day.
  return new Set(logDates.filter((d) => d >= from && d <= to)).size;
}

export interface HabitWeek {
  /** It has a rhythm of its own; false means "most days", the original habit. */
  weekly: boolean;
  /** Times logged this week so far. Descriptive — never compared out loud. */
  done: number;
  /** The rhythm has been kept. Only ever true for a weekly habit. */
  met: boolean;
  /** "2 this week". What the chip says; never "2 of 3". */
  label: string;
}

export function habitWeek(
  habit: Pick<Habit, 'timesPerWeek'>,
  logDates: string[],
  on: Date = new Date()
): HabitWeek {
  const weekly = !!habit.timesPerWeek;
  const done = timesThisWeek(logDates, on);
  return {
    weekly,
    done,
    met: weekly && done >= habit.timesPerWeek!,
    label: done === 0 ? 'Not yet this week' : done === 1 ? 'Once this week' : `${done} this week`
  };
}

/** The order habits are drawn in: where they were dragged to, then oldest first. */
export const byHabitOrder = (a: Habit, b: Habit): number =>
  (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

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
/**
 * The last `days` calendar days, oldest first, each marked done or not.
 *
 * The row-sized version of the detail page's heatmap, and deliberately the same
 * two states: on or off. Nothing is shaded by how much or how often, because
 * shading against an expected amount is a completion percentage in a costume.
 *
 * Local days, built from parts — `new Date('2026-09-08')` is UTC midnight,
 * which is the day before anywhere west of Greenwich, and a habit logged this
 * evening would show up on the wrong square.
 */
export function recentDays(
  logDates: string[],
  days = 14,
  from: Date = new Date()
): { date: string; on: boolean }[] {
  const done = new Set(logDates);
  const out: { date: string; on: boolean }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: iso, on: done.has(iso) });
  }
  return out;
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** "active Jan 2026 – Mar 2026 · dormant Mar 2026 – Aug 2026 · active Aug 2026 –" */
export function cycleSummary(cycles: Cycle[]): string {
  return cycles
    .map((c) => `${c.state} ${monthLabel(c.from)} – ${c.to ? monthLabel(c.to) : ''}`.trim())
    .join(' · ');
}
