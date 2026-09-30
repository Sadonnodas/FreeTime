import { describe, it, expect } from 'vitest';
import { BY_WINDOW, byDue, byLabel, comingUp } from './deadlines';
import type { Todo } from './types';

/**
 * The rules here are mostly about what the app must NOT do with a deadline.
 * "No overdue state" is the app's first rule, and a field whose whole purpose
 * is a day something has to happen before is the likeliest place to grow one
 * by accident — so the absence of escalation is pinned, not just the presence
 * of the feature.
 */

const TODAY = '2026-11-10';

const todo = (by: string | undefined, over: Partial<Todo> = {}): Todo =>
  ({
    id: by ?? 'none',
    title: by ?? 'none',
    by,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...over
  }) as Todo;

describe('when a deadline starts showing', () => {
  it('raises one inside the window', () => {
    expect(byDue(todo('2026-11-14'), TODAY)).toBe(true);
  });

  it('raises one falling exactly on the horizon', () => {
    expect(byDue(todo('2026-11-17'), TODAY)).toBe(true);
    expect(BY_WINDOW).toBe(7);
  });

  it('leaves one further out alone', () => {
    // The point of the window: a deadline in December is not today's business,
    // and putting it on Today for a month is how the calmest screen fills up.
    expect(byDue(todo('2026-11-18'), TODAY)).toBe(false);
    expect(byDue(todo('2026-12-24'), TODAY)).toBe(false);
  });

  it('GOES ON RAISING ONE THAT HAS PASSED', () => {
    // The half that matters. A reminder that stops reminding you the moment
    // the day arrives has quit at exactly the wrong time — the car still needs
    // its inspection on the 16th.
    expect(byDue(todo('2026-11-09'), TODAY)).toBe(true);
    expect(byDue(todo('2026-08-01'), TODAY)).toBe(true);
  });

  it('ignores a to-do with no deadline at all', () => {
    expect(byDue(todo(undefined), TODAY)).toBe(false);
  });
});

describe('how a deadline reads', () => {
  it('names the near days and dates the rest', () => {
    expect(byLabel('2026-11-10', TODAY)).toBe('Before today');
    expect(byLabel('2026-11-11', TODAY)).toBe('Before tomorrow');
    expect(byLabel('2026-11-15', TODAY)).toContain('Before ');
    expect(byLabel('2026-11-15', TODAY)).toContain('15');
  });

  it('SAYS THE SAME THING AFTER THE DAY HAS PASSED', () => {
    // No "late", no "overdue", no count of days. The words a deadline gets on
    // the 9th are the words it gets on the 20th; the reader knows the date.
    const before = byLabel('2026-11-15', '2026-11-10');
    const after = byLabel('2026-11-15', '2026-11-20');
    expect(after).toBe(before);
    expect(after.toLowerCase()).not.toMatch(/late|overdue|missed|days ago/);
  });
});

describe('what comes up on Today', () => {
  it('puts the soonest first', () => {
    const rows = comingUp(
      [todo('2026-11-16'), todo('2026-11-11'), todo('2026-11-13')],
      new Set(),
      TODAY
    );
    expect(rows.map((t) => t.by)).toEqual(['2026-11-11', '2026-11-13', '2026-11-16']);
  });

  it('never promotes a passed one above an earlier deadline', () => {
    // Sorted by the date alone. Anything that moved a passed deadline to the
    // top "because it is late" would be an overdue pile in a different order.
    const rows = comingUp([todo('2026-11-12'), todo('2026-11-08')], new Set(), TODAY);
    expect(rows.map((t) => t.by)).toEqual(['2026-11-08', '2026-11-12']);
  });

  it('leaves out what Today is already showing', () => {
    const rows = comingUp([todo('2026-11-12', { id: 'slotted' })], new Set(['slotted']), TODAY);
    expect(rows).toEqual([]);
  });

  it('keeps one ticked today, and drops it tomorrow', () => {
    const done = todo('2026-11-12', { completedAt: `${TODAY}T18:00:00.000Z` });
    // Still there on the day it was ticked: the tap must not pull the row out
    // from under the thumb that made it.
    expect(comingUp([done], new Set(), TODAY)).toHaveLength(1);
    expect(comingUp([done], new Set(), '2026-11-11')).toHaveLength(0);
  });
});
