import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { activityByProject, monthsAgoIso } from './queries';
import { createProject, createTodo, completeTodo, createBuyItem, markPurchased } from './store';

/**
 * The chart on Me is the app's one deliberate exception to "no analytics", so
 * what it counts had better be right. The window boundaries are the part worth
 * pinning: an off-by-one here quietly rewrites how a whole year looked.
 */

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(reset);

const sixMonths = () => monthsAgoIso(6);

describe('activityByProject', () => {
  it('counts a closed to-do against its project', async () => {
    const p = await createProject('Music');
    const t = await createTodo('mix it', { projectId: p });
    await completeTodo(t);

    const [row] = await activityByProject(sixMonths());
    expect(row!.project.name).toBe('Music');
    expect(row!.closed).toBe(1);
    expect(row!.events).toBe(1);
  });

  it('adds purchases to the same total', async () => {
    const p = await createProject('Campervan');
    const b = await createBuyItem('water pump', { projectId: p });
    await markPurchased(b);

    const [row] = await activityByProject(sixMonths());
    expect(row!.bought).toBe(1);
    expect(row!.events).toBe(1);
  });

  it('ignores anything closed before the window', async () => {
    const p = await createProject('Music');
    const t = await createTodo('old thing', { projectId: p });
    await completeTodo(t);
    // Backdated past the edge by hand: completeTodo always stamps now.
    await db.todos.update(t, { completedAt: monthsAgoIso(9) });

    const [row] = await activityByProject(sixMonths());
    expect(row!.events).toBe(0);
  });

  it('keeps a project with nothing in it, at zero', async () => {
    // The empty row is the entire reason for looking at this: a project that
    // did not happen has to be visible, not filtered out for being quiet.
    await createProject('Family');
    const rows = await activityByProject(sixMonths());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.events).toBe(0);
  });

  it('busiest first, then alphabetical so ties do not jitter', async () => {
    const music = await createProject('Music');
    const admin = await createProject('Admin');
    const van = await createProject('Van');
    for (const p of [music, music, admin, van]) {
      const t = await createTodo('x', { projectId: p });
      await completeTodo(t);
    }

    expect((await activityByProject(sixMonths())).map((r) => r.project.name)).toEqual([
      'Music',
      'Admin',
      'Van'
    ]);
  });

  it('does not count work with no project against anyone', async () => {
    await createProject('Music');
    const loose = await createTodo('unassigned');
    await completeTodo(loose);

    const [row] = await activityByProject(sixMonths());
    expect(row!.events).toBe(0);
  });

  it('ignores deleted records', async () => {
    const p = await createProject('Music');
    const t = await createTodo('mix it', { projectId: p });
    await completeTodo(t);
    await db.todos.update(t, { deletedAt: new Date().toISOString() });

    const [row] = await activityByProject(sixMonths());
    expect(row!.events).toBe(0);
  });
});

describe('monthsAgoIso', () => {
  it('walks back whole months, not thirty-day blocks', () => {
    const from = new Date('2026-08-30T12:00:00.000Z');
    expect(monthsAgoIso(6, from).slice(0, 7)).toBe('2026-02');
    expect(monthsAgoIso(12, from).slice(0, 7)).toBe('2025-08');
  });
});
