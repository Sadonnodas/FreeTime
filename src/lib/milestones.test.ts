import { describe, it, expect } from 'vitest';
import { habitMilestones, milestoneToday, milestoneWhen } from './milestones';

/**
 * The brief carried its own warning: *"streaks are dangerous, because when you
 * lose one it can trigger me to give up."* So what is pinned here is not only
 * that milestones are awarded, but that nothing they produce can ever go down.
 */

/** N days ending on `last`, walking backwards. */
const daysBack = (n: number, last = '2026-09-20') => {
  const [y, m, d] = last.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(y!, m! - 1, d! - i);
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    );
  }
  return out.reverse();
};

/** One log a week, on the Monday, for `n` weeks from 2026-06-01 (a Monday). */
const mondays = (n: number, skip: number[] = []) => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    const d = new Date(2026, 5, 1 + i * 7);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return out;
};

describe('counting what has been done', () => {
  it('awards a milestone on the day it was reached, not today', () => {
    const dates = daysBack(12);
    const m = habitMilestones({}, dates).find((x) => x.value === 10)!;
    expect(m.label).toBe('10 times');
    // The 10th log, two days before the last one — and it stays that date.
    expect(m.at).toBe(dates[9]);
  });

  it('never takes one away, whatever happens afterwards', () => {
    const ten = daysBack(10);
    const before = habitMilestones({}, ten);
    // Months of nothing. A streak would read zero; this reads the same.
    const after = habitMilestones({}, ten);
    expect(after).toEqual(before);
    expect(after[0]!.label).toBe('10 times');
  });

  it('counts all time, because a yearly count resets and that is the same wound', () => {
    const dates = [...daysBack(30, '2025-12-31'), ...daysBack(30, '2026-09-20')];
    // 60 logs across a new year: still 50, not "10 this year".
    expect(habitMilestones({}, dates).some((m) => m.value === 50 && m.kind === 'count')).toBe(true);
  });

  it('counts a day once, however many rows say so', () => {
    const doubled = [...daysBack(10), ...daysBack(10)];
    expect(habitMilestones({}, doubled).some((m) => m.value === 10)).toBe(true);
    expect(habitMilestones({}, doubled).some((m) => m.value === 25)).toBe(false);
  });
});

describe('weeks in a row', () => {
  it('gives one line per run, at the highest it reached', () => {
    const runs = habitMilestones({}, mondays(12)).filter((m) => m.kind === 'run');
    // A twelve-week run is "12 weeks running", not 4 and 8 and 12.
    expect(runs).toHaveLength(1);
    expect(runs[0]!.label).toBe('12 weeks running');
  });

  it('gives a later run its own line rather than comparing it with the first', () => {
    // Five weeks, a gap, then five more. Coming back is recognised.
    const dates = [...mondays(11, [5])];
    const runs = habitMilestones({}, dates).filter((m) => m.kind === 'run');
    expect(runs.map((r) => r.label)).toEqual(['4 weeks running', '4 weeks running']);
  });

  it('says nothing at all about a run that broke', () => {
    const dates = mondays(6, [4, 5]);
    const all = habitMilestones({}, dates);
    // One award for the four weeks that happened, and no record of the break:
    // nothing is dated to the week it stopped, and nothing says "ended".
    expect(all.filter((m) => m.kind === 'run')).toHaveLength(1);
    expect(JSON.stringify(all)).not.toMatch(/ended|broken|lost|best/i);
  });

  it('holds a weekly habit to its own rhythm, not to "at least once"', () => {
    // Three times a week, but only one log in each week: no run was done.
    expect(habitMilestones({ timesPerWeek: 3 }, mondays(8)).filter((m) => m.kind === 'run'))
      .toHaveLength(0);
  });

  it("does not move an ongoing run's date as it grows", () => {
    const at = (n: number) =>
      habitMilestones({}, mondays(n)).find((m) => m.kind === 'run' && m.value === 4)!.at;
    // The day the fourth week closed is a fact; weeks five and six do not
    // rewrite it.
    expect(at(6)).toBe(at(4));
  });
});

describe('the moment it happens', () => {
  it('finds a milestone reached today, and nothing on an ordinary day', () => {
    const dates = daysBack(10, '2026-09-20');
    expect(milestoneToday({}, dates, '2026-09-20')?.label).toBe('10 times');
    expect(milestoneToday({}, dates, '2026-09-19')).toBeNull();
  });

  it('prefers the rarer news when both land on one day', () => {
    // 4 weeks running and the 10th log on the same Monday.
    const dates = [...mondays(4), ...daysBack(7, '2026-06-18')].sort();
    const hit = milestoneToday({}, dates, dates.at(-1)!);
    expect(hit?.kind).toBe('run');
  });
});

describe('how a milestone reads', () => {
  it('dates a count and spans a run', () => {
    const count = habitMilestones({}, daysBack(10))[0]!;
    expect(milestoneWhen(count)).toMatch(/2026/);
    const run = habitMilestones({}, mondays(8)).find((m) => m.kind === 'run')!;
    expect(milestoneWhen(run)).toMatch(/–|2026/);
  });
});
