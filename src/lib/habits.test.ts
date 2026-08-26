import { describe, it, expect } from 'vitest';
import { buildCycles, heatmapWeeks, type Cycle } from './habits';
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
