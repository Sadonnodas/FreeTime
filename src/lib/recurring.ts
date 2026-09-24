import type { Todo } from './types';

/**
 * To-dos that come round again — the bins out every Thursday.
 *
 * Asked for plainly: *"we need to put the trashcans outside every Thursday
 * evening, so I would like that it would appear in my Today page every
 * Thursday."*
 *
 * **WHY THIS IS NOT A HABIT, even though the machinery rhymes.** A habit is
 * about you and is deliberately day-less — *"3 times a week, without specific
 * days"* — because fixing Mon/Wed/Fri turns four days of the week into
 * something you can be late for. A bin day is not an ambition: Thursday is a
 * fact about the lorry, not a target you set. So it stays a TO-DO, appears in
 * today's list where the day's other jobs are, and never joins the habit chips
 * or the heatmap.
 *
 * **WHY IT IS NOT A DATED TO-DO PER WEEK EITHER**, which was the obvious
 * build: Free Time's obligation slot takes dated to-dos with a date of today
 * or earlier, oldest first. Generate one per Thursday and a single missed bin
 * day becomes the first thing Free Time offers you for the rest of time — an
 * overdue pile arriving through the back door of the mechanic that exists to
 * prevent one. One row plus a log per day it was done has nothing to
 * accumulate: a missed Thursday is a Thursday with no log, and nothing
 * anywhere counts it.
 */

/** 0 = Sunday, matching `Date.getDay()`. */
export const WEEKDAYS: { day: number; short: string; label: string }[] = [
  { day: 1, short: 'M', label: 'Monday' },
  { day: 2, short: 'T', label: 'Tuesday' },
  { day: 3, short: 'W', label: 'Wednesday' },
  { day: 4, short: 'T', label: 'Thursday' },
  { day: 5, short: 'F', label: 'Friday' },
  { day: 6, short: 'S', label: 'Saturday' },
  { day: 0, short: 'S', label: 'Sunday' }
];

export const repeats = (todo: Pick<Todo, 'repeatDays'>): boolean =>
  !!todo.repeatDays?.length;

/** The weekday an ISO date falls on, built from parts — `new Date('2026-09-24')`
 *  is UTC midnight, which is the day before anywhere west of Greenwich. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

/** Whether this to-do comes round on that day. */
export function repeatsOn(todo: Pick<Todo, 'repeatDays'>, iso: string): boolean {
  return repeats(todo) && todo.repeatDays!.includes(weekdayOf(iso));
}

/**
 * "Every Thursday", "Mondays and Fridays", "Every day".
 *
 * Said in words rather than as seven letters, because the row has to be
 * readable at a glance and "M T W T F S S" with three of them lit is a puzzle.
 * The picker itself is the letters; this is the sentence under it.
 */
export function repeatLabel(days: number[] | undefined): string | null {
  const picked = WEEKDAYS.filter((w) => days?.includes(w.day));
  if (!picked.length) return null;
  if (picked.length === 7) return 'Every day';
  if (picked.length === 1) return `Every ${picked[0]!.label}`;
  const names = picked.map((w) => `${w.label}s`);
  return names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
}
