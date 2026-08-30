import { db } from './db';
import type { Idea } from './types';
import { now } from './store';

/**
 * Folding the inbox and lists into Ideas.
 *
 * THE ID IS THE WHOLE TRICK. A migration is code that runs on every device
 * independently, which is exactly the shape of the bug that duplicated ten
 * projects: two devices each minted their own rows with fresh uuids, sync
 * matched on id, and kept both sets.
 *
 * So a migrated idea REUSES the id of the row it came from. Ideas and captures
 * live in different tables, so there is no collision, and both devices
 * therefore produce byte-identical records. Sync merges them into one instead
 * of stacking them, and running this twice is a no-op rather than a mess.
 *
 * The source rows are tombstoned, not deleted, so the change propagates the way
 * every other delete does.
 */
export async function migrateToFourKinds(): Promise<{ captures: number; listItems: number }> {
  const t = now();
  let captures = 0;
  let listItems = 0;

  // --- the inbox ------------------------------------------------------------
  // Unsorted captures become unfiled ideas. Ones already triaged into a to-do
  // or an idea are left alone: their content is elsewhere already, and
  // resurrecting it would duplicate what the user has since filed.
  const pending = (await db.captures.toArray()).filter((c) => !c.deletedAt && !c.sortedAt);
  for (const c of pending) {
    const existing = await db.ideas.get(c.id);
    if (!existing) {
      const idea: Idea = {
        id: c.id,
        text: c.text,
        // Kept, so a thought captured in March stays dated March.
        createdAt: c.createdAt,
        updatedAt: t
      };
      await db.ideas.add(idea);
    }
    await db.captures.update(c.id, { deletedAt: t, updatedAt: t });
    captures += 1;
  }

  // --- lists ----------------------------------------------------------------
  const lists = (await db.lists.toArray()).filter((l) => !l.deletedAt);
  const nameById = new Map(lists.map((l) => [l.id, l.name]));

  const items = (await db.listItems.toArray()).filter((i) => !i.deletedAt);
  for (const item of items) {
    const existing = await db.ideas.get(item.id);
    if (!existing) {
      const idea: Idea = {
        id: item.id,
        text: item.text,
        group: nameById.get(item.listId),
        // 'done' was already counted as a win, and doneAt keeps that true.
        doneAt: item.state === 'done' ? item.updatedAt : undefined,
        createdAt: item.createdAt,
        updatedAt: t
      };
      await db.ideas.add(idea);
    }
    await db.listItems.update(item.id, { deletedAt: t, updatedAt: t });
    listItems += 1;
  }

  for (const l of lists) {
    await db.lists.update(l.id, { deletedAt: t, updatedAt: t });
  }

  return { captures, listItems };
}

/** Cheap enough to check on every boot, and it has to be: a device that has
 *  been offline for a week will pull down un-migrated rows from another one. */
export async function needsMigration(): Promise<boolean> {
  const stale = await db.captures.filter((c) => !c.deletedAt && !c.sortedAt).count();
  if (stale > 0) return true;
  return (await db.listItems.filter((i) => !i.deletedAt).count()) > 0;
}
