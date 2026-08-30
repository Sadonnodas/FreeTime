import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { migrateToFourKinds, needsMigration } from './migrate';
import type { Capture, List, ListItem } from './types';

/**
 * The property that actually matters here is convergence.
 *
 * This migration runs independently on every device. The last time code did
 * that with fresh uuids — the starter projects — two devices each minted their
 * own copies, sync matched on id, and every project appeared twice. Reusing the
 * source row's id is what stops that happening again, so it is asserted rather
 * than trusted.
 */

const t = '2026-08-01T10:00:00.000Z';

const capture = (over: Partial<Capture> = {}): Capture => ({
  id: 'c1',
  text: 'ring the garage',
  createdAt: t,
  updatedAt: t,
  ...over
});

const list = (over: Partial<List> = {}): List => ({
  id: 'l1',
  name: 'Books',
  createdAt: t,
  updatedAt: t,
  ...over
});

const listItem = (over: Partial<ListItem> = {}): ListItem => ({
  id: 'li1',
  listId: 'l1',
  text: 'Sapiens',
  state: 'want',
  createdAt: t,
  updatedAt: t,
  ...over
});

beforeEach(async () => {
  await Promise.all([db.captures.clear(), db.lists.clear(), db.listItems.clear(), db.ideas.clear()]);
});

describe('the inbox becomes unfiled ideas', () => {
  it('carries the text and the original date across', async () => {
    await db.captures.add(capture());
    await migrateToFourKinds();

    const idea = await db.ideas.get('c1');
    expect(idea!.text).toBe('ring the garage');
    expect(idea!.group).toBeUndefined();
    // A thought captured in March should still say March.
    expect(idea!.createdAt).toBe(t);
  });

  it('tombstones the capture rather than deleting it', async () => {
    await db.captures.add(capture());
    await migrateToFourKinds();
    expect((await db.captures.get('c1'))!.deletedAt).toBeTruthy();
  });

  it('leaves already-sorted captures alone', async () => {
    // Their content was filed as a to-do or an idea long ago; bringing it back
    // would duplicate something the user has already dealt with.
    await db.captures.add(capture({ sortedAt: t }));
    await migrateToFourKinds();
    expect(await db.ideas.count()).toBe(0);
  });
});

describe('lists become grouped ideas', () => {
  it('uses the list name as the group', async () => {
    await db.lists.add(list());
    await db.listItems.add(listItem());
    await migrateToFourKinds();

    const idea = await db.ideas.get('li1');
    expect(idea!.text).toBe('Sapiens');
    expect(idea!.group).toBe('Books');
  });

  it('keeps a finished item finished, so it still counts as a win', async () => {
    await db.lists.add(list());
    await db.listItems.add(listItem({ state: 'done', updatedAt: '2026-08-09T09:00:00.000Z' }));
    await migrateToFourKinds();

    expect((await db.ideas.get('li1'))!.doneAt).toBe('2026-08-09T09:00:00.000Z');
  });

  it('leaves an unfinished item unfinished', async () => {
    await db.lists.add(list());
    await db.listItems.add(listItem({ state: 'doing' }));
    await migrateToFourKinds();
    expect((await db.ideas.get('li1'))!.doneAt).toBeUndefined();
  });
});

describe('running it more than once', () => {
  it('is a no-op the second time', async () => {
    await db.captures.add(capture());
    await db.lists.add(list());
    await db.listItems.add(listItem());

    await migrateToFourKinds();
    const first = await db.ideas.toArray();
    await migrateToFourKinds();

    expect(await db.ideas.count()).toBe(first.length);
  });

  it('reuses the source id, so two devices converge instead of duplicating', async () => {
    await db.captures.add(capture());
    await db.lists.add(list());
    await db.listItems.add(listItem());
    await migrateToFourKinds();

    // Same ids as the rows they came from. Another device running the same
    // migration produces the same ids, so sync merges rather than stacks —
    // which is exactly what the seeded projects got wrong.
    expect((await db.ideas.toArray()).map((i) => i.id).sort()).toEqual(['c1', 'li1']);
  });

  it('does not resurrect an idea the user has since deleted', async () => {
    await db.captures.add(capture());
    await migrateToFourKinds();
    await db.ideas.update('c1', { deletedAt: t });

    await migrateToFourKinds();
    expect((await db.ideas.get('c1'))!.deletedAt).toBe(t);
  });
});

describe('needsMigration', () => {
  it('is false on a clean store', async () => {
    expect(await needsMigration()).toBe(false);
  });

  it('is true while old rows are still around', async () => {
    await db.captures.add(capture());
    expect(await needsMigration()).toBe(true);
    await migrateToFourKinds();
    expect(await needsMigration()).toBe(false);
  });

  it('notices list items arriving later from another device', async () => {
    await db.listItems.add(listItem());
    expect(await needsMigration()).toBe(true);
  });
});
