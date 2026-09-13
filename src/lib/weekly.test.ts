import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { weekStart, ymd, pendingWeeklySummary, markWeekShown } from './weekly';

/**
 * The weekly look-back sits one step from a banned feature ("no weekly
 * planning"), and what keeps it on the right side is a handful of rules that
 * are all about WHEN it appears and what it refuses to say. Those are the
 * things a later change would break without noticing, so they are pinned here.
 */

// A fixed Wednesday, so "last week" is always the same seven days.
const WED = new Date(2026, 8, 16, 10, 0); // 16 Sep 2026
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();
const stamp = new Date().toISOString();

async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function todo(id: string, title: string, completedAt?: string, extra: object = {}) {
  await db.todos.put({ id, title, completedAt, createdAt: stamp, updatedAt: stamp, ...extra });
}

beforeEach(reset);

describe('the week', () => {
  it('starts on Monday, and Sunday belongs to the week before it', () => {
    expect(ymd(weekStart(new Date(2026, 8, 14)))).toBe('2026-09-14'); // Monday
    expect(ymd(weekStart(new Date(2026, 8, 16)))).toBe('2026-09-14'); // Wednesday
    expect(ymd(weekStart(new Date(2026, 8, 20, 23, 59)))).toBe('2026-09-14'); // Sunday night
  });

  it('crosses a month boundary without losing a day', () => {
    // Thursday 1 October belongs to the week that began on Monday 28 September.
    expect(ymd(weekStart(new Date(2026, 9, 1)))).toBe('2026-09-28');
  });
});

describe('what it looks back on', () => {
  it('takes last Monday to Sunday, and nothing from this week or before', async () => {
    await todo('before', 'Too early', at(2026, 8, 6)); // Sunday of the week before
    await todo('mon', 'Monday one', at(2026, 8, 7, 0)); // first hour of last week
    await todo('sun', 'Sunday one', at(2026, 8, 13, 23)); // last hour of last week
    await todo('now', 'This week', at(2026, 8, 14, 9)); // already this week
    await todo('open', 'Still open');

    const s = (await pendingWeeklySummary(WED))!;
    const texts = s.groups.flatMap((g) => g.items.map((i) => i.text));
    expect(texts.sort()).toEqual(['Monday one', 'Sunday one']);
    expect(s.label).toMatch(/^7 – 13 /);
  });

  it('counts recordings, purchases and finished ideas, not only ticks', async () => {
    await db.memos.put({
      id: 'm', title: 'Chorus idea', mime: 'audio/mp4', durationMs: 1000,
      recordedAt: at(2026, 8, 9), createdAt: stamp, updatedAt: stamp
    });
    await db.buyItems.put({
      id: 'b', name: 'Varnish', purchasedAt: at(2026, 8, 10), createdAt: stamp, updatedAt: stamp
    });
    await db.ideas.put({
      id: 'i', text: 'Read Sapiens', doneAt: at(2026, 8, 11), createdAt: stamp, updatedAt: stamp
    });

    const s = (await pendingWeeklySummary(WED))!;
    const kinds = s.groups.flatMap((g) => g.items.map((i) => i.kind)).sort();
    expect(kinds).toEqual(['bought', 'finished', 'recorded']);
    expect(s.total).toBe(3);
  });

  it('leaves out anything deleted', async () => {
    await todo('gone', 'Deleted', at(2026, 8, 9), { deletedAt: stamp });
    await todo('kept', 'Kept', at(2026, 8, 9));
    const s = (await pendingWeeklySummary(WED))!;
    expect(s.total).toBe(1);
  });

  it('groups by era and project, with unfiled things last', async () => {
    await db.projects.put({
      id: 'van', name: 'Campervan', tags: ['Furniture'], archived: false, createdAt: stamp, updatedAt: stamp
    });
    await todo('a', 'Varnish', at(2026, 8, 8), { projectId: 'van', tag: 'Furniture' });
    await todo('b', 'Sand', at(2026, 8, 9), { projectId: 'van', tag: 'Furniture' });
    await todo('c', 'Ferry', at(2026, 8, 10));

    const s = (await pendingWeeklySummary(WED))!;
    expect(s.groups.map((g) => [g.era?.name, g.tag, g.items.length])).toEqual([
      ['Campervan', 'Furniture', 2],
      [undefined, undefined, 1]
    ]);
  });

  it('gives habits as distinct days, never as a fraction of the week', async () => {
    await db.habits.put({
      id: 'h', name: 'Guitar', state: 'active', stateChangedAt: stamp, createdAt: stamp, updatedAt: stamp
    } as never);
    for (const [id, date] of [
      ['l1', '2026-09-08'],
      ['l2', '2026-09-08'], // the same day twice: one day, not two
      ['l3', '2026-09-12'],
      ['l4', '2026-09-14'] // this week: not counted
    ]) {
      await db.habitLogs.put({ id, habitId: 'h', date, createdAt: stamp, updatedAt: stamp });
    }

    const s = (await pendingWeeklySummary(WED))!;
    expect(s.habits).toEqual([{ name: 'Guitar', days: 2 }]);
    // There is no denominator anywhere in the shape, and that is the point.
    expect(JSON.stringify(s.habits)).not.toMatch(/\/7|total|of/);
  });
});

describe('when it appears', () => {
  it('appears once a week and not again after being shown', async () => {
    await todo('a', 'Done', at(2026, 8, 9));
    expect(await pendingWeeklySummary(WED)).not.toBeNull();

    await markWeekShown('2026-09-14');
    expect(await pendingWeeklySummary(WED)).toBeNull();
    // Still that week on Sunday night: still shown.
    expect(await pendingWeeklySummary(new Date(2026, 8, 20, 22))).toBeNull();
  });

  it('comes back the following week', async () => {
    await markWeekShown('2026-09-14');
    await todo('a', 'Done last week', at(2026, 8, 15));
    // The Monday after: a new week, and last week had something in it.
    expect(await pendingWeeklySummary(new Date(2026, 8, 21, 8))).not.toBeNull();
  });

  it('says nothing about an empty week, and does not keep asking', async () => {
    expect(await pendingWeeklySummary(WED)).toBeNull();
    const settings = await db.settings.get('settings');
    // Marked shown, so an empty week is not re-checked on every open.
    expect(settings?.lastWeeklySummaryShown).toBe('2026-09-14');
  });
});
