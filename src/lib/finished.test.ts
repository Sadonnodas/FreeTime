import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import {
  createProject, setProjectTags, setProjectTagFinished, setProjectTagSleeping,
  renameProjectTag, moveProjectTag, removeProjectTag, createTodo, completeTodo,
  createBuyItem, markPurchased
} from './store';
import { winsSince, projectRecap } from './queries';
import { createPlanner } from './freetime';

/**
 * "I just finished building a closet in our bedroom that was a big project. I
 * would be satisfied if I could check that whole project off as completed."
 *
 * The parts that fail silently are the ones pinned: a finished state that a
 * rename or a move drops, an open to-do quietly ticked on your behalf, and a
 * finished project that keeps being suggested.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(reset);

async function home() {
  const era = await createProject('Home');
  await setProjectTags(era, ['Closet', 'Garden']);
  return era;
}

describe('finishing a project', () => {
  it('records when, and can be taken back', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Closet', true);
    expect((await db.projects.get(era))!.finishedTags?.Closet).toBeTruthy();

    await setProjectTagFinished(era, 'Closet', false);
    expect((await db.projects.get(era))!.finishedTags?.Closet).toBeUndefined();
  });

  it('keeps the original date if finished twice', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Closet', true);
    const first = (await db.projects.get(era))!.finishedTags!.Closet;
    await new Promise((r) => setTimeout(r, 5));
    await setProjectTagFinished(era, 'Closet', true);
    expect((await db.projects.get(era))!.finishedTags!.Closet).toBe(first);
  });

  it('leaves open to-dos open rather than ticking them for you', async () => {
    const era = await home();
    const todo = await createTodo('touch up the paint', { projectId: era, tag: 'Closet' });
    await setProjectTagFinished(era, 'Closet', true);
    expect((await db.todos.get(todo))!.completedAt).toBeUndefined();
  });

  it('takes a sleeping project out of sleep', async () => {
    const era = await home();
    await setProjectTagSleeping(era, 'Closet', true);
    await setProjectTagFinished(era, 'Closet', true);
    expect((await db.projects.get(era))!.sleepingTags).not.toContain('Closet');
  });

  it('refuses a project the era does not have', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Nope', true);
    expect((await db.projects.get(era))!.finishedTags?.Nope).toBeUndefined();
  });
});

describe('a finished project survives being handled', () => {
  it('stays finished through a rename', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Closet', true);
    await renameProjectTag(era, 'Closet', 'Bedroom closet');
    const row = (await db.projects.get(era))!;
    expect(row.finishedTags?.['Bedroom closet']).toBeTruthy();
    expect(row.finishedTags?.Closet).toBeUndefined();
  });

  it('stays ASLEEP through a rename too, which it used not to', async () => {
    const era = await home();
    await setProjectTagSleeping(era, 'Garden', true);
    await renameProjectTag(era, 'Garden', 'Back garden');
    expect((await db.projects.get(era))!.sleepingTags).toEqual(['Back garden']);
  });

  it('stays finished when moved to another era', async () => {
    const era = await home();
    const other = await createProject('Woodwork');
    await setProjectTagFinished(era, 'Closet', true);
    expect(await moveProjectTag(era, 'Closet', other)).toBe('moved');
    expect((await db.projects.get(other))!.finishedTags?.Closet).toBeTruthy();
    expect((await db.projects.get(era))!.finishedTags?.Closet).toBeUndefined();
  });

  it('is forgotten when the project itself is removed', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Closet', true);
    await removeProjectTag(era, 'Closet');
    expect((await db.projects.get(era))!.finishedTags?.Closet).toBeUndefined();
  });
});

describe('what finishing means elsewhere', () => {
  it('counts as a win', async () => {
    const era = await home();
    await setProjectTagFinished(era, 'Closet', true);
    const wins = await winsSince('2000-01-01T00:00:00.000Z');
    expect(wins.map((w) => w.text)).toContain('Finished Closet');
  });

  it('stops Free Time suggesting what was left open in it', async () => {
    const era = await home();
    await createTodo('touch up the paint', { projectId: era, tag: 'Closet' });
    await createTodo('plant the pots', { projectId: era, tag: 'Garden' });
    await setProjectTagFinished(era, 'Closet', true);
    const planner = await createPlanner({ time: 'all day', brain: 'sharp' });
    expect(planner.pool.map((t) => t.title)).toEqual(['plant the pots']);
  });

  it('sums up what the project added up to, as counts and never as a fraction', async () => {
    const era = await home();
    const a = await createTodo('frame', { projectId: era, tag: 'Closet' });
    await createTodo('paint', { projectId: era, tag: 'Closet' });
    await completeTodo(a);
    const hinge = await createBuyItem('hinges', { projectId: era, tag: 'Closet' });
    await markPurchased(hinge, true);
    await createTodo('elsewhere', { projectId: era, tag: 'Garden' });

    const recap = await projectRecap(era, 'Closet');
    expect(recap).toMatchObject({ done: 1, open: 1, bought: 1, recorded: 0 });
    expect(recap.startedAt).toBeTruthy();
    expect(Object.keys(recap)).not.toContain('percent');
  });
});
