import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createTodo, createHabit, reorderHabits, setTodoAfter, completeTodo } from './store';
import { indexById } from './order';
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

describe("a day list reads down its chains", () => {
  /**
   * *"The also-on-this-day to-dos don't respect the order of to-dos if you had
   * given them a comes-after setting."* Every other list that shows a chain
   * already reads down it; a day list is the one place where reading top to
   * bottom is the whole point.
   */
  const index = async () => indexById(await db.todos.toArray());

  it('puts what something waits for above it, whatever order they were written in', async () => {
    const grass = await createTodo('Sow the grass', { date: today() });
    const bamboo = await createTodo('Remove the bamboo', { date: today() });
    await setTodoAfter(grass, bamboo);

    const rows = (await db.todos.toArray()).sort(byDayList([], await index()));
    expect(rows.map((t) => t.title)).toEqual(['Remove the bamboo', 'Sow the grass']);
  });

  it('keeps the dragged order WITHIN one depth', async () => {
    const [a, b, c] = await Promise.all(
      ['a', 'b', 'c'].map((t) => createTodo(t, { date: today() }))
    );
    await reorderDayList([c, a, b]);
    const order = (await ensureDay()).listOrder;

    const rows = (await db.todos.toArray()).sort(byDayList(order, await index()));
    expect(rows.map((t) => t.id)).toEqual([c, a, b]);
  });

  it('lets the chain beat the drag, rather than the other way round', async () => {
    const grass = await createTodo('Sow the grass', { date: today() });
    const bamboo = await createTodo('Remove the bamboo', { date: today() });
    await setTodoAfter(grass, bamboo);
    // Dragged the wrong way up: the link is a fact about the work, the drag is
    // a preference about the rest, so the link wins and the row snaps back.
    await reorderDayList([grass, bamboo]);
    const order = (await ensureDay()).listOrder;

    const rows = (await db.todos.toArray()).sort(byDayList(order, await index()));
    expect(rows.map((t) => t.title)).toEqual(['Remove the bamboo', 'Sow the grass']);
  });

  it('stops holding a to-do down once its blocker is done', async () => {
    const grass = await createTodo('Sow the grass', { date: today() });
    const bamboo = await createTodo('Remove the bamboo', { date: today() });
    await setTodoAfter(grass, bamboo);
    await completeTodo(bamboo);
    await reorderDayList([grass, bamboo]);
    const order = (await ensureDay()).listOrder;

    // A finished blocker blocks nothing, so the dragged order is honoured again.
    const rows = (await db.todos.toArray()).sort(byDayList(order, await index()));
    expect(rows.map((t) => t.title)).toEqual(['Sow the grass', 'Remove the bamboo']);
  });

  it('resolves a blocker that is not on the day list at all', async () => {
    // The index must be every to-do: a blocker filed in a project you are not
    // looking at is still a blocker, and an index of the visible rows alone
    // would read the link as dangling and sort it as ready.
    const elsewhere = await createTodo('Remove the bamboo');
    const grass = await createTodo('Sow the grass', { date: today() });
    const other = await createTodo('Water the pots', { date: today() });
    await setTodoAfter(grass, elsewhere);
    await reorderDayList([grass, other]);
    const order = (await ensureDay()).listOrder;

    const onTheDay = (await db.todos.toArray()).filter((t) => t.date === today());
    const rows = onTheDay.sort(byDayList(order, await index()));
    expect(rows.map((t) => t.title)).toEqual(['Water the pots', 'Sow the grass']);
  });

  it('is unchanged when no index is handed over', async () => {
    const grass = await createTodo('Sow the grass', { date: today() });
    const bamboo = await createTodo('Remove the bamboo', { date: today() });
    await setTodoAfter(grass, bamboo);
    await reorderDayList([grass, bamboo]);
    const order = (await ensureDay()).listOrder;
    // The old comparator, still used by callers that have no index.
    const rows = (await db.todos.toArray()).sort(byDayList(order));
    expect(rows.map((t) => t.title)).toEqual(['Sow the grass', 'Remove the bamboo']);
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

describe('habit colours', () => {
  it('hands each new habit a colour the others are not wearing, and keeps a chosen one', async () => {
    const { setHabitColor, PROJECT_COLORS } = await import('./store');
    const { habitColor } = await import('./habits');
    const a = await createHabit('Guitar');
    const b = await createHabit('Run');
    const [ha, hb] = [(await db.habits.get(a))!, (await db.habits.get(b))!];
    expect(ha.color).toBe(PROJECT_COLORS[0]);
    expect(hb.color).toBe(PROJECT_COLORS[1]);
    await setHabitColor(a, PROJECT_COLORS[5]);
    expect(habitColor((await db.habits.get(a))!)).toBe(PROJECT_COLORS[5]);
    // One from before colours still gets a stable one.
    const old = { id: 'abc', color: undefined };
    expect(habitColor(old)).toBe(habitColor(old));
    expect(PROJECT_COLORS).toContain(habitColor(old));
  });
});
