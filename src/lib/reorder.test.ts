import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createTodo, createHabit, reorderHabits } from './store';
import { addToDay, ensureDay, reorderDay, reorderDayList, byDayList } from './day';
import { today } from './store';
import { byHabitOrder } from './habits';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("dragging the day's three into a new order", () => {
  it('writes the new order', async () => {
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of [a, b, c]) await addToDay(id);
    await reorderDay([c, a, b]);
    expect((await ensureDay()).slots).toEqual([c, a, b]);
  });

  it('can rearrange but never add, drop or duplicate a slot', async () => {
    const [a, b, c, stranger] = await Promise.all(['a', 'b', 'c', 'd'].map((t) => createTodo(t)));
    for (const id of [a, b, c]) await addToDay(id);
    // A stale drag from before `a` was... still there, plus an id that is not on the day.
    await reorderDay([b, stranger, b, c]);
    expect((await ensureDay()).slots).toEqual([b, c, a]);
  });
});

describe('dragging habits into a new order', () => {
  it('keeps the dragged order, with new habits joining at the end', async () => {
    const guitar = await createHabit('Guitar');
    const run = await createHabit('Run');
    const read = await createHabit('Read');
    await reorderHabits([read, guitar, run]);
    const walk = await createHabit('Walk');
    const names = (await db.habits.toArray()).sort(byHabitOrder).map((h) => h.name);
    expect(names).toEqual(['Read', 'Guitar', 'Run', 'Walk']);
    expect(walk).toBeTruthy();
  });
});

describe("dragging today's day list", () => {
  it('keeps the dragged order, with new to-dos joining at the end', async () => {
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t, { date: today() })));
    await reorderDayList([c, a, b, a]);
    expect((await ensureDay()).listOrder).toEqual([c, a, b]);
    const d = await createTodo('d', { date: today() });
    const order = (await ensureDay()).listOrder;
    const rows = (await db.todos.toArray()).sort(byDayList(order)).map((t) => t.id);
    expect(rows).toEqual([c, a, b, d]);
  });
});

describe("dragging an era's projects", () => {
  it('reorders the awake ones and keeps sleeping and finished ones', async () => {
    const { createProject, setProjectTags, reorderProjectTags, setProjectTagSleeping } = await import('./store');
    const era = await createProject('Music');
    await setProjectTags(era, ['Mixing', 'Covers', 'Old song', 'Album']);
    await setProjectTagSleeping(era, 'Old song', true);
    const colours = { ...(await db.projects.get(era))!.tagColors };
    await reorderProjectTags(era, ['Album', 'Mixing', 'Nonsense', 'Covers']);
    const after = (await db.projects.get(era))!;
    expect(after.tags).toEqual(['Album', 'Mixing', 'Covers', 'Old song']);
    expect(after.sleepingTags).toEqual(['Old song']);
    expect(after.tagColors).toEqual(colours);
  });
});
