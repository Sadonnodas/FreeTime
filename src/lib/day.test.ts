import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createTodo, completeTodo } from './store';
import {
  ensureDay, addToDay, removeFromDay, setDaySlots, maybeCloseDay,
  canUnlockOneMore, unlockOneMore, DayFullError, STARTING_SLOTS
} from './day';

/**
 * The unlock rule is the spec's single most important behavioural mechanic, and
 * it is the one thing most likely to be quietly broken by a future refactor of
 * the Today screen. These tests hold the invariant at the data layer, where the
 * UI cannot reach around it.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('the unlock rule', () => {
  beforeEach(reset);

  it('starts a day at three slots', async () => {
    const day = await ensureDay();
    expect(day.unlockedCount).toBe(STARTING_SLOTS);
    expect(day.slots).toEqual([]);
  });

  it('makes a fourth item impossible to add in advance', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);

    const fourth = await createTodo('d');
    await expect(addToDay(fourth)).rejects.toBeInstanceOf(DayFullError);

    const day = await ensureDay();
    expect(day.slots).toHaveLength(3);
  });

  it('does not close the day until the third slot is done', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);

    await completeTodo(ids[0]!);
    expect(await maybeCloseDay()).toBe(false);
    await completeTodo(ids[1]!);
    expect(await maybeCloseDay()).toBe(false);

    await completeTodo(ids[2]!);
    expect(await maybeCloseDay()).toBe(true);
    expect((await ensureDay()).closedAt).toBeTruthy();
  });

  it('closes the day exactly once', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);
    for (const id of ids) await completeTodo(id);

    expect(await maybeCloseDay()).toBe(true);
    // A second call must not re-trigger the day-close screen.
    expect(await maybeCloseDay()).toBe(false);
  });

  it('offers "one more" only after the day has closed', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);

    expect(await canUnlockOneMore()).toBe(false);
    await expect(unlockOneMore()).rejects.toThrow();

    for (const id of ids) await completeTodo(id);
    await maybeCloseDay();

    expect(await canUnlockOneMore()).toBe(true);
  });

  it('unlocks one at a time, never more', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);
    for (const id of ids) await completeTodo(id);
    await maybeCloseDay();

    await unlockOneMore();
    expect((await ensureDay()).unlockedCount).toBe(4);

    const fourth = await createTodo('d');
    await addToDay(fourth);

    // The fifth is not visible in advance — the day must be re-earned first.
    const fifth = await createTodo('e');
    await expect(addToDay(fifth)).rejects.toBeInstanceOf(DayFullError);
  });

  it('accepting a fresh plan resets the unlocked count', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);
    for (const id of ids) await completeTodo(id);
    await maybeCloseDay();
    await unlockOneMore();

    const next = await Promise.all(['x', 'y'].map((t) => createTodo(t)));
    const day = await setDaySlots(next);

    expect(day.unlockedCount).toBe(STARTING_SLOTS);
    expect(day.closedAt).toBeUndefined();
  });

  it('skipping frees the slot again', async () => {
    const ids = await Promise.all(['a', 'b', 'c'].map((t) => createTodo(t)));
    for (const id of ids) await addToDay(id);

    await removeFromDay(ids[1]!);
    const replacement = await createTodo('d');
    await addToDay(replacement);

    const day = await ensureDay();
    expect(day.slots).toHaveLength(3);
    expect(day.slots).toContain(replacement);
  });

  it('never adds the same todo twice', async () => {
    const id = await createTodo('a');
    await addToDay(id);
    await addToDay(id);
    expect((await ensureDay()).slots).toEqual([id]);
  });
});
