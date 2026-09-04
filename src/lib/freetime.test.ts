import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createProject, createTodo, completeTodo, today } from './store';
import { effortCeiling, fitsTime, createPlanner, planDay } from './freetime';
import type { FreeTimeAnswers } from './types';

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

const ask = (over: Partial<FreeTimeAnswers> = {}): FreeTimeAnswers => ({
  time: 'all day',
  brain: 'sharp',
  ...over
});

describe('effort and time are separate axes', () => {
  it('bounds effort by how your head is, and nothing else', () => {
    expect(effortCeiling('fried')).toBe('quick');
    expect(effortCeiling('normal')).toBe('moderate');
    expect(effortCeiling('sharp')).toBe('focus');
  });

  it('does not let a short window rule out an easy job', () => {
    // The old model mapped "20 minutes free" onto "quick wins only", which
    // conflated the two: a quick win is LOW EFFORT, and you can spend a whole
    // day on quick wins. Twenty minutes should rule out long jobs, not
    // demanding ones.
    const short = { id: 'a', title: 'hard but short', energy: 'focus' } as never;
    expect(fitsTime(short, '20min')).toBe(true);
  });

  it('rules a long job out of a short window', () => {
    const long = { id: 'b', title: 'sanding', takes: 'half day' } as never;
    expect(fitsTime(long, '20min')).toBe(false);
    expect(fitsTime(long, 'half day')).toBe(true);
    expect(fitsTime(long, 'all day')).toBe(true);
  });

  it('keeps a job with no estimate, rather than assuming it is long', () => {
    const unknown = { id: 'c', title: 'no estimate' } as never;
    expect(fitsTime(unknown, '20min')).toBe(true);
  });
});

describe('the two filters together', () => {
  beforeEach(reset);

  it('offers a long easy job when there is all day, even while fried', async () => {
    await createTodo('sand the boards', { energy: 'quick', takes: 'half day' });
    const planner = await createPlanner(ask({ time: 'all day', brain: 'fried' }));
    expect(planner.pool.map((t) => t.title)).toEqual(['sand the boards']);
  });

  it('offers a short demanding job in twenty minutes when sharp', async () => {
    await createTodo('decide the layout', { energy: 'focus', takes: '20min' });
    const planner = await createPlanner(ask({ time: '20min', brain: 'sharp' }));
    expect(planner.pool.map((t) => t.title)).toEqual(['decide the layout']);
  });

  it('withholds that same demanding job when fried, however short it is', async () => {
    await createTodo('decide the layout', { energy: 'focus', takes: '20min' });
    const planner = await createPlanner(ask({ time: '20min', brain: 'fried' }));
    expect(planner.pool).toEqual([]);
  });

  it('plans the short demanding job into a twenty-minute window', async () => {
    // End to end, not just the pool: the two-axis filter has to survive slot
    // selection, or the fix is invisible where it matters.
    const p = await createProject('Woodwork');
    await createTodo('Sand the boards', { projectId: p, energy: 'quick', takes: 'half day' });
    await createTodo('Decide the joinery', { projectId: p, energy: 'focus', takes: '20min' });

    const slots = await planDay(ask({ time: '20min', brain: 'sharp' }));
    expect(slots.map((s) => s.todo.title)).toContain('Decide the joinery');
    expect(slots.map((s) => s.todo.title)).not.toContain('Sand the boards');
  });

  it('withholds a long job in a short window, however easy it is', async () => {
    await createTodo('sand the boards', { energy: 'quick', takes: 'half day' });
    const planner = await createPlanner(ask({ time: '20min', brain: 'sharp' }));
    expect(planner.pool).toEqual([]);
  });
});

describe('candidate filtering', () => {
  beforeEach(reset);

  it('never surfaces a focus block when fried', async () => {
    await createTodo('big thing', { energy: 'focus' });
    await createTodo('small thing', { energy: 'quick' });

    const planner = await createPlanner(ask({ time: 'all day', brain: 'fried' }));
    expect(planner.pool.map((t) => t.title)).toEqual(['small thing']);
  });

  it('keeps untagged to-dos in the pool', async () => {
    // Capture sets no energy, so this is the common case. If untagged items
    // were filtered out the flow would return nothing in normal use.
    await createTodo('captured thing');
    const planner = await createPlanner(ask({ time: '20min', brain: 'fried' }));
    expect(planner.pool).toHaveLength(1);
  });

  it('ignores completed and deleted to-dos', async () => {
    const done = await createTodo('done');
    await completeTodo(done);
    await createTodo('open');

    const planner = await createPlanner(ask());
    expect(planner.pool.map((t) => t.title)).toEqual(['open']);
  });
});

describe('slot rules', () => {
  beforeEach(reset);

  it('puts the named project in the pull slot', async () => {
    const discGolf = await createProject('Disc Golf');
    const admin = await createProject('Admin');
    await createTodo('boring form', { projectId: admin });
    await createTodo('putting practice', { projectId: discGolf });

    const slots = await planDay(ask({ projectPullId: discGolf }));
    const pull = slots.find((s) => s.kind === 'pull');
    expect(pull?.todo.title).toBe('putting practice');
  });

  it('picks the quietest project for the neglected slot', async () => {
    const quiet = await createProject('Campervan');
    const busy = await createProject('Coding');
    await createTodo('van thing', { projectId: quiet });
    await createTodo('code thing', { projectId: busy });

    // Touching Coding makes Campervan the quieter of the two.
    const touched = await createTodo('shipped', { projectId: busy });
    await completeTodo(touched);

    const slots = await planDay(ask({ projectPullId: busy }));
    const neglected = slots.find((s) => s.kind === 'neglected');
    expect(neglected?.todo.title).toBe('van thing');
  });

  it('never offers the pulled project as the neglected one', async () => {
    const p = await createProject('Music');
    await createTodo('a', { projectId: p });
    await createTodo('b', { projectId: p });

    const slots = await planDay(ask({ projectPullId: p }));
    expect(slots.some((s) => s.kind === 'neglected')).toBe(false);
  });

  it('fills the obligation slot only when a dated item exists', async () => {
    await createTodo('undated');
    let slots = await planDay(ask());
    expect(slots.some((s) => s.kind === 'obligation')).toBe(false);

    await createTodo('dated', { date: today() });
    slots = await planDay(ask());
    expect(slots.find((s) => s.kind === 'obligation')?.todo.title).toBe('dated');
  });

  it('does not describe a past date as overdue', async () => {
    await createTodo('old obligation', { date: '2026-01-02' });
    const slots = await planDay(ask());
    const reason = slots.find((s) => s.kind === 'obligation')?.reason ?? '';
    expect(reason.toLowerCase()).not.toMatch(/overdue|late|missed|behind/);
  });

  it('returns two slots rather than inventing a third', async () => {
    const a = await createProject('A');
    const b = await createProject('B');
    await createTodo('one', { projectId: a });
    await createTodo('two', { projectId: b });

    const slots = await planDay(ask({ projectPullId: a }));
    expect(slots).toHaveLength(2);
  });

  it('never repeats a to-do across slots', async () => {
    const p = await createProject('Solo');
    await createTodo('only thing', { projectId: p, date: today() });

    const slots = await planDay(ask());
    const ids = slots.map((s) => s.todo.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps at three even with plenty available', async () => {
    for (let i = 0; i < 10; i++) {
      const p = await createProject(`P${i}`);
      await createTodo(`t${i}`, { projectId: p, date: today() });
    }
    expect(await planDay(ask())).toHaveLength(3);
  });

  it('returns nothing when the pile is empty, without throwing', async () => {
    expect(await planDay(ask())).toEqual([]);
  });
});
