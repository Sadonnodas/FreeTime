import { describe, it, expect } from 'vitest';
import {
  buildCycles, heatmapWeeks, type Cycle, recentDays, timesThisWeek, habitWeek, rhythmLabel
} from './habits';
import type { Habit, HabitStateChange, HabitState } from './types';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Guitar',
  state: 'active',
  stateChangedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

const change = (state: HabitState, at: string): HabitStateChange => ({
  id: `c-${at}`,
  habitId: 'h1',
  state,
  at,
  createdAt: at,
  updatedAt: at
});

const states = (cycles: Cycle[]) => cycles.map((c) => c.state);

describe('cycle history', () => {
  it('reads as a sequence of cycles, not a streak', () => {
    const cycles = buildCycles(habit({ state: 'active' }), [
      change('active', '2026-01-01T00:00:00.000Z'),
      change('dormant', '2026-03-01T00:00:00.000Z'),
      change('active', '2026-08-01T00:00:00.000Z')
    ]);

    expect(states(cycles)).toEqual(['active', 'dormant', 'active']);
    expect(cycles[0]!.to).toBe('2026-03-01T00:00:00.000Z');
    // The current cycle is open-ended — "active since August", not "active for
    // 25 days", which would be a streak by another name.
    expect(cycles[2]!.to).toBeUndefined();
  });

  it('synthesises a first cycle for habits older than the change log', () => {
    // Habits created before this feature existed have no change rows. They must
    // not render an empty history.
    const cycles = buildCycles(habit({ createdAt: '2025-06-01T00:00:00.000Z' }), []);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.state).toBe('active');
    expect(cycles[0]!.from).toBe('2025-06-01T00:00:00.000Z');
  });

  it('does not treat a repeated state as a new cycle', () => {
    const cycles = buildCycles(habit(), [
      change('active', '2026-01-01T00:00:00.000Z'),
      change('active', '2026-02-01T00:00:00.000Z'),
      change('dormant', '2026-03-01T00:00:00.000Z')
    ]);
    expect(states(cycles)).toEqual(['active', 'dormant']);
  });

  it('attributes logs to the cycle they happened in', () => {
    const cycles = buildCycles(
      habit(),
      [
        change('active', '2026-01-01T00:00:00.000Z'),
        change('dormant', '2026-03-01T00:00:00.000Z'),
        change('active', '2026-08-01T00:00:00.000Z')
      ],
      ['2026-01-15', '2026-02-20', '2026-05-01', '2026-08-10']
    );

    expect(cycles[0]!.logCount).toBe(2);
    // A dormant cycle can still hold logs. The app does not police that.
    expect(cycles[1]!.logCount).toBe(1);
    expect(cycles[2]!.logCount).toBe(1);
  });

  it('ignores deleted change records', () => {
    const deleted = { ...change('dormant', '2026-03-01T00:00:00.000Z'), deletedAt: 'x' };
    expect(states(buildCycles(habit(), [change('active', '2026-01-01T00:00:00.000Z'), deleted])))
      .toEqual(['active']);
  });

  it('orders changes that arrive out of sequence', () => {
    // Sync can deliver rows in any order.
    const cycles = buildCycles(habit(), [
      change('active', '2026-08-01T00:00:00.000Z'),
      change('dormant', '2026-03-01T00:00:00.000Z'),
      change('active', '2026-01-01T00:00:00.000Z')
    ]);
    expect(states(cycles)).toEqual(['active', 'dormant', 'active']);
  });
});

describe('heatmap grid', () => {
  it('returns whole weeks', () => {
    const grid = heatmapWeeks([], 26);
    expect(grid).toHaveLength(26);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it('marks only logged days, with no notion of a target', () => {
    const grid = heatmapWeeks([]);
    expect(grid.flat().every((d) => d.on === false)).toBe(true);
    // Every cell is a plain boolean — there is no intensity to shade against a
    // goal, because that would be a completion percentage in disguise.
    expect(grid.flat().every((d) => typeof d.on === 'boolean')).toBe(true);
  });
});

describe('the fortnight on a habit row', () => {
  // Fixed "today" so the test does not drift, and built from parts for the same
  // reason the function is: new Date('2026-09-08') is UTC midnight, which is
  // the day before west of Greenwich.
  const on = new Date(2026, 8, 8); // 8 September 2026

  it('ends on today and runs backwards a fortnight', () => {
    const days = recentDays([], 14, on);
    expect(days).toHaveLength(14);
    expect(days.at(-1)!.date).toBe('2026-09-08');
    expect(days[0].date).toBe('2026-08-26');
  });

  it('marks the days that were logged and only those', () => {
    const days = recentDays(['2026-09-08', '2026-09-01'], 14, on);
    expect(days.filter((d) => d.on).map((d) => d.date)).toEqual(['2026-09-01', '2026-09-08']);
  });

  it('ignores a log from outside the window rather than shifting it in', () => {
    expect(recentDays(['2026-01-01'], 14, on).some((d) => d.on)).toBe(false);
  });

  it('crosses a month boundary without inventing a day', () => {
    const dates = recentDays([], 14, new Date(2026, 2, 3)).map((d) => d.date);
    expect(dates).toContain('2026-02-28');
    expect(dates).toContain('2026-03-01');
    expect(new Set(dates).size).toBe(14);
  });
});

describe('a habit with a rhythm of its own', () => {
  // Monday 14 September 2026 through Sunday the 20th. Built from parts, since
  // new Date('2026-09-14') is UTC midnight and would be the Sunday before
  // anywhere west of Greenwich.
  const wednesday = new Date(2026, 8, 16);
  const sunday = new Date(2026, 8, 20);

  it('counts only the days inside this week, Monday to Sunday', () => {
    const logs = ['2026-09-13', '2026-09-14', '2026-09-16'];
    // The 13th is the Sunday BEFORE: last week's, and last week is never
    // mentioned again.
    expect(timesThisWeek(logs, wednesday)).toBe(2);
    // Sunday still belongs to the week that began on Monday.
    expect(timesThisWeek([...logs, '2026-09-20'], sunday)).toBe(3);
  });

  it('does not count a day that has not happened yet', () => {
    // A log dated later in the week arrives from a device whose clock or
    // timezone is ahead. Counting it would call the rhythm kept before it was.
    expect(timesThisWeek(['2026-09-16', '2026-09-18'], wednesday)).toBe(1);
  });

  it('counts a day once, however many rows say so', () => {
    // Two devices can each write the same date before they merge.
    expect(timesThisWeek(['2026-09-16', '2026-09-16'], wednesday)).toBe(1);
  });

  it('is kept once the week has had its three, and stays kept', () => {
    const h = { timesPerWeek: 3 };
    const logs = ['2026-09-14', '2026-09-15', '2026-09-16'];
    expect(habitWeek(h, logs, wednesday).met).toBe(true);
    // Still met on Sunday with nothing added since: a rhythm that is met stops
    // asking for the rest of the week, which is the whole point of having one.
    expect(habitWeek(h, logs, sunday).met).toBe(true);
    // And doing more than the rhythm is never remarked on.
    expect(habitWeek(h, [...logs, '2026-09-17'], sunday).met).toBe(true);
  });

  it('says what has happened and never what is left', () => {
    const w = habitWeek({ timesPerWeek: 3 }, ['2026-09-14', '2026-09-16'], wednesday);
    expect(w.done).toBe(2);
    expect(w.met).toBe(false);
    // No fraction, no count-down, nowhere: "2 of 3" and "1 to go" are the
    // completion percentage the spec bans, and habits.ts says why the number
    // the user typed is still allowed to exist.
    expect(w.label).toBe('2 this week');
    expect(JSON.stringify(w)).not.toMatch(/of 3|to go|1 left/);
  });

  it('leaves a habit with no rhythm exactly as it was', () => {
    const w = habitWeek({}, ['2026-09-14', '2026-09-16'], wednesday);
    expect(w.weekly).toBe(false);
    // Never met, so nothing about a "most days" habit settles or sinks early —
    // its only question is still today's.
    expect(w.met).toBe(false);
    expect(rhythmLabel(undefined)).toBe('Most days');
  });

  it('names a rhythm the way it is said out loud', () => {
    expect(rhythmLabel(1)).toBe('Once a week');
    expect(rhythmLabel(2)).toBe('Twice a week');
    expect(rhythmLabel(3)).toBe('3 times a week');
  });
});
