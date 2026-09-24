import { describe, it, expect, beforeEach } from 'vitest';
import { repeats, repeatsOn, repeatLabel, weekdayOf } from './recurring';
import { db } from './db';
import { createProject, createTodo, setTodoRepeat, toggleTodoLog } from './store';
import { createPlanner } from './freetime';

describe('a to-do that comes round again', () => {
  it('knows which weekday a date falls on, in local time', () => {
    // 24 September 2026 is a Thursday. Built from parts on purpose:
    // new Date('2026-09-24') is UTC midnight, which is Wednesday west of
    // Greenwich, and the bins would go out on the wrong day.
    expect(weekdayOf('2026-09-24')).toBe(4);
    expect(weekdayOf('2026-09-27')).toBe(0);
  });

  it('appears on its day and is simply absent on the others', () => {
    const bins = { repeatDays: [4] };
    expect(repeatsOn(bins, '2026-09-24')).toBe(true); // Thursday
    expect(repeatsOn(bins, '2026-09-25')).toBe(false); // Friday
    // Absent, not late: nothing marks the Friday as a miss, because there is
    // nothing dated to be late about.
  });

  it('treats an empty list as not repeating at all', () => {
    expect(repeats({ repeatDays: [] })).toBe(false);
    expect(repeats({})).toBe(false);
    expect(repeatsOn({ repeatDays: [] }, '2026-09-24')).toBe(false);
  });

  it('says what it does in words', () => {
    expect(repeatLabel([4])).toBe('Every Thursday');
    expect(repeatLabel([1, 5])).toBe('Mondays and Fridays');
    expect(repeatLabel([1, 3, 5])).toBe('Mondays, Wednesdays and Fridays');
    expect(repeatLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(repeatLabel(undefined)).toBeNull();
  });

  it('reads the days in week order however they were picked', () => {
    // The picker can hand them over in tap order; the sentence must not say
    // "Fridays and Mondays".
    expect(repeatLabel([5, 1])).toBe('Mondays and Fridays');
  });
});

describe('what a repeat does to the rest of the app', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('clears the date, because a thing cannot be both', async () => {
    const id = await createTodo('Bins out', { date: '2026-09-24' });
    await setTodoRepeat(id, [4]);

    const todo = (await db.todos.get(id))!;
    expect(todo.repeatDays).toEqual([4]);
    // Left on, Today would have to choose which of the two it was showing.
    expect(todo.date).toBeUndefined();
  });

  it('records being done per DAY, not once and for ever', async () => {
    const id = await createTodo('Bins out', { repeatDays: [4] });

    expect(await toggleTodoLog(id, '2026-09-24')).toBe(true);
    // Next Thursday starts clean — one row, many Thursdays.
    expect(await toggleTodoLog(id, '2026-10-01')).toBe(true);
    expect((await db.todoLogs.toArray()).filter((l) => !l.deletedAt)).toHaveLength(2);

    // And the to-do itself is never retired by a tick.
    expect((await db.todos.get(id))!.completedAt).toBeUndefined();
  });

  it('untickes the same day rather than writing a second log', async () => {
    const id = await createTodo('Bins out', { repeatDays: [4] });
    await toggleTodoLog(id, '2026-09-24');
    expect(await toggleTodoLog(id, '2026-09-24')).toBe(false);
    expect((await db.todoLogs.toArray()).filter((l) => !l.deletedAt)).toHaveLength(0);
    // The row survives as a tombstone so two devices keep one id for that day.
    expect(await db.todoLogs.count()).toBe(1);
  });

  it('is never offered by Free Time', async () => {
    // It has no completedAt by design, so it would otherwise sit in the pool
    // for ever and be suggested on a Tuesday.
    const era = await createProject('Home');
    await createTodo('Bins out', { projectId: era, repeatDays: [4] });
    await createTodo('Fix the shelf', { projectId: era });

    const planner = await createPlanner({ time: 'all day', brain: 'sharp' });
    expect(planner.pool.map((t) => t.title)).toEqual(['Fix the shelf']);
  });

  it('stops repeating cleanly, leaving no stale weekday behind', async () => {
    const id = await createTodo('Bins out', { repeatDays: [4] });
    await setTodoRepeat(id, undefined);
    // Dexie deletes a property set to undefined, so another device reads a
    // plain to-do rather than one that still claims a Thursday.
    expect('repeatDays' in (await db.todos.get(id))!).toBe(false);
  });
});
