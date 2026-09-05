import { today } from './store';

/**
 * Naming a calendar day, for the day list in Brain → To-dos.
 *
 * A day list is a plain list of everything due on one date. It is deliberately
 * NOT the Today screen's three slots: that is a hard limit with an unlock
 * mechanic behind it (spec 5.3), and the whole point of it is that three is all
 * you get. "Everything I have to do tomorrow" is a different question, and
 * forcing it through the three would either break the mechanic or lose the
 * list. So this reuses the field a to-do already has — `date` — and adds no
 * table, no concept and no third level.
 *
 * Because it is the same field, a day list composes with what exists: anything
 * on it is a dated to-do, so it already feeds Free Time's obligation slot and
 * already shows under "Has a date".
 */

/** Shift a YYYY-MM-DD by whole days, staying in local time. */
export function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  // Built from parts, never `new Date(iso)`: that parses YYYY-MM-DD as UTC
  // midnight, which is the previous day anywhere west of Greenwich.
  return today(new Date(y, m - 1, d + days));
}

export const tomorrow = (from: string = today()): string => shiftDay(from, 1);

/**
 * "Today", "Tomorrow", "Yesterday", or "Fri 5 Sep".
 *
 * The three relative names are the ones worth having: a list you are looking at
 * now is almost always one of them, and a date you have to decode is a date you
 * misread. Everything else gets the weekday, because "the 12th" means nothing
 * and "Thursday" means something.
 */
export function dayLabel(iso: string, ref: string = today()): string {
  if (iso === ref) return 'Today';
  if (iso === shiftDay(ref, 1)) return 'Tomorrow';
  if (iso === shiftDay(ref, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

/**
 * The same day, as it reads mid-sentence: "add to tomorrow", "the list for
 * Sat 12 Sep". Only the three relative names lowercase — a date is a proper
 * noun and "sat 12 sep" looks like a typo.
 */
export function dayPhrase(iso: string, ref: string = today()): string {
  const label = dayLabel(iso, ref);
  return ['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label.toLowerCase() : label;
}
