import { db } from './db';

/**
 * Opening the local store, and nothing else.
 *
 * This used to also seed ten starter projects on an empty database, and that
 * turned out to be the cause of a real data bug.
 *
 * WHAT WENT WRONG. Seeding runs whenever the database is empty, which is true
 * of every NEW DEVICE — and it runs before the first sync, because sync cannot
 * start until the store is open. So a second device minted its own ten projects
 * with fresh uuids, then pulled down the first device's ten, and merge (which
 * matches on id, correctly) kept all twenty. Every project appeared twice, and
 * the copy the user was looking at was the local one, so a cover photo set on
 * the laptop looked like it had failed to sync when it was really sitting on
 * the other copy of the same name.
 *
 * Deterministic ids derived from the names would have made the two sets merge
 * instead of collide, and that would have been the fix if seeding were worth
 * keeping. It is not: a personal starter list is somebody else's clutter, and
 * an app that opens with ten projects you did not create is strange for anyone
 * but the person the list was written for.
 *
 * So a new install now starts empty. The Projects screen says so.
 */
export async function openStore(): Promise<void> {
  // Any query forces Dexie to open the database and run pending migrations,
  // which is the thing worth failing loudly on. The result is discarded.
  await db.projects.count();
}
