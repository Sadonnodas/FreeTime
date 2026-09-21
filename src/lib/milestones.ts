import { today } from './store';
import { weekStart } from './days';
import { monthLabel } from './habits';
import type { Habit } from './types';

/**
 * WHAT YOU HAVE DONE, counted in a way that cannot be taken away.
 *
 * Asked for in the owner's own words, which contain both the request and the
 * warning: *"I know streaks are dangerous, because when you build one up and
 * then lose it, it can trigger me to give up instead of rebuilding. But it
 * would be nice to have something that tells me: you did this habit 100 times.
 * Or 4 consecutive weeks of ear training. Something that pushes me to keep
 * going without leaving the emptiness of losing."*
 *
 * THE RULE THAT MAKES THIS LEGAL. The spec bans streaks, and the ban is not
 * about counting — the app already counts, on every habit row ("47 logged")
 * and in the cycle history. What it bans is A NUMBER YOU CAN LOSE and a target
 * you can fall short of. A streak counter is live: it sits on screen at 23,
 * you watch it, and one quiet Tuesday it says 0. That zero is the thing this
 * app exists to not do.
 *
 * So everything here is PAST TENSE AND PERMANENT. A milestone is a thing that
 * happened, on a day, like a win in the wins feed or a finished project: once
 * earned it is on the shelf forever, and nothing that happens afterwards can
 * remove it or reduce it. The app never shows a run in progress as a number,
 * never says a run ended, never names a best to be compared against, and never
 * says how far it is to the next one. There is nothing on any screen that can
 * go down.
 *
 * A COUNT THAT RESETS IS THE SAME TRAP. The request said "100 times this
 * year", and a yearly count is a streak with a calendar for a trigger: on the
 * 1st of January a habit done 300 times reads 2, which is exactly the emptiness
 * being avoided. Counts here are ALL TIME.
 *
 * Nothing is stored. These are derived from the logs every time, like wins —
 * no table to migrate, no row to fall out of step with the thing it describes,
 * and a log arriving from another device is counted the moment it lands.
 */

/** Milestones worth noticing. Close enough together early that a new habit
 *  reaches one; far enough apart later that they stay rare. */
export const COUNT_MILESTONES = [10, 25, 50, 100, 200, 365, 500, 1000];

/** Weeks in a row, the thing "4 consecutive weeks of ear training" asked for. */
export const RUN_MILESTONES = [4, 8, 12, 26, 52];

export interface Milestone {
  kind: 'count' | 'run';
  /** 100 times, or 8 weeks. */
  value: number;
  /** "100 times", "8 weeks running". */
  label: string;
  /** The day it was reached — YYYY-MM-DD, and it never moves afterwards. */
  at: string;
  /** For a run, the week it started in, so the shelf can say "Jul – Sep". */
  from?: string;
}

const uniqueSorted = (dates: string[]) => [...new Set(dates)].sort();

/** The Monday of the week a date falls in. */
function weekOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return today(weekStart(new Date(y!, m! - 1, d!)));
}

const addWeek = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return today(new Date(y!, m! - 1, d! + 7));
};

/**
 * Weeks in which this habit HAPPENED, in order.
 *
 * A week counts when the habit met its own rhythm — three times for a habit
 * meant three times a week, once for an ordinary one. Judging a weekly habit
 * by "at least one" would hand out runs it did not do; judging a daily one by
 * seven would hand out almost none, and this is not a scoreboard.
 */
function weeksDone(dates: string[], need: number): string[] {
  const perWeek = new Map<string, number>();
  for (const d of uniqueSorted(dates)) {
    const w = weekOf(d);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  return [...perWeek.entries()]
    .filter(([, n]) => n >= need)
    .map(([w]) => w)
    .sort();
}

/** Consecutive stretches of weeks done, each with the dates inside it. */
function runsOf(dates: string[], need: number): { weeks: string[] }[] {
  const weeks = weeksDone(dates, need);
  const runs: { weeks: string[] }[] = [];
  for (const w of weeks) {
    const last = runs.at(-1);
    if (last && addWeek(last.weeks.at(-1)!) === w) last.weeks.push(w);
    else runs.push({ weeks: [w] });
  }
  return runs;
}

/**
 * Every milestone this habit has reached, newest first.
 *
 * One line per run, at the highest threshold that run got to — a twelve-week
 * run is "12 weeks running", not three separate entries — and a later run of
 * its own earns its own line, so coming back and doing four more weeks is
 * recognised rather than compared with what went before.
 */
export function habitMilestones(
  habit: Pick<Habit, 'timesPerWeek'>,
  logDates: string[]
): Milestone[] {
  const dates = uniqueSorted(logDates);
  const out: Milestone[] = [];

  for (const n of COUNT_MILESTONES) {
    if (dates.length >= n) {
      out.push({ kind: 'count', value: n, label: `${n} times`, at: dates[n - 1]! });
    }
  }

  const need = habit.timesPerWeek ?? 1;
  for (const run of runsOf(dates, need)) {
    const reached = [...RUN_MILESTONES].reverse().find((w) => run.weeks.length >= w);
    if (!reached) continue;
    // The day the run's Nth week was completed — a fixed point, so an ongoing
    // run's milestone does not drift forward every time it is added to.
    const closing = run.weeks[reached - 1]!;
    const inThatWeek = dates.filter((d) => weekOf(d) === closing);
    out.push({
      kind: 'run',
      value: reached,
      label: `${reached} weeks running`,
      at: inThatWeek.at(-1) ?? closing,
      from: run.weeks[0]
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** "Jul – Sep 2026" for a run, "12 September 2026" for a count. */
export function milestoneWhen(m: Milestone): string {
  if (m.kind === 'run' && m.from) {
    const from = monthLabel(m.from);
    const to = monthLabel(m.at);
    return from === to ? from : `${from} – ${to}`;
  }
  const [y, mo, d] = m.at.split('-').map(Number);
  return new Date(y!, mo! - 1, d!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * The one reached TODAY, if any — the moment worth celebrating.
 *
 * Derived rather than remembered, which is what keeps it stateless: a
 * milestone dated today is one that was crossed today. The cost is that
 * unticking and reticking the hundredth replays it, which is a shrug; the
 * alternative is a table recording which celebrations have been seen, and this
 * app does not add tables for confetti.
 */
export function milestoneToday(
  habit: Pick<Habit, 'timesPerWeek'>,
  logDates: string[],
  on: string = today()
): Milestone | null {
  const hit = habitMilestones(habit, logDates).filter((m) => m.at === on);
  // A count and a run can land on the same day; the rarer one is the news.
  return hit.sort((a, b) => (a.kind === 'run' ? -1 : 1) - (b.kind === 'run' ? -1 : 1))[0] ?? null;
}
