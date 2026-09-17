import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createTodo, createHabit, reorderHabits } from './store';
import { addToDay, ensureDay, reorderDay } from './day';
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
